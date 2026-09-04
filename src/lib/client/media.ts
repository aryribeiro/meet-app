// Camada MEDIA: captura, perfis de envio (escada de qualidade) e monitor com
// histerese. Limiares definidos ANTES do código (constants.ts; PROMPT.md emenda 3
// estendida para 4 degraus no conselho de 2026-09-04).
import { QualityLadder, type LimitReason, type QualitySample } from "@/lib/shared/ladder";
export type { LimitReason, QualitySample } from "@/lib/shared/ladder";
import {
  AUDIO_BITRATE_DEGRADED,
  AUDIO_BITRATE_NORMAL,
  MIN_DELTA_PACKETS,
  STATS_INTERVAL_MS,
  VIDEO_MAX_BITRATE,
  VIDEO_SD_MAX_BITRATE,
  VIDEO_SD_SCALE,
  type QualityTier,
} from "@/lib/shared/constants";

/** Preferência de dispositivos escolhida pelo usuário (vazio = padrão do sistema). */
export interface DevicePreference {
  micId?: string;
  camId?: string;
}

/** Captura com vídeo 720p (contrato) e processamento de voz ligado. */
export async function getLocalMedia(
  withVideo: boolean,
  pref: DevicePreference = {},
): Promise<MediaStream> {
  const video: MediaTrackConstraints | false = withVideo
    ? pref.camId
      ? { deviceId: { exact: pref.camId }, width: { ideal: 1280 }, height: { ideal: 720 } }
      : { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" }
    : false;
  const audio: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
  if (pref.micId) audio.deviceId = { exact: pref.micId };
  return navigator.mediaDevices.getUserMedia({ audio, video });
}

export interface MediaDeviceOption {
  id: string;
  label: string;
}

/**
 * Lista câmeras e microfones. Os rótulos só existem depois de uma permissão de
 * mídia concedida — por isso chamar após o primeiro getUserMedia.
 */
export async function listDevices(): Promise<{
  cams: MediaDeviceOption[];
  mics: MediaDeviceOption[];
}> {
  const cams: MediaDeviceOption[] = [];
  const mics: MediaDeviceOption[] = [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    for (const d of devices) {
      if (!d.deviceId) continue;
      if (d.kind === "videoinput") {
        cams.push({ id: d.deviceId, label: d.label || `Câmera ${cams.length + 1}` });
      } else if (d.kind === "audioinput") {
        mics.push({ id: d.deviceId, label: d.label || `Microfone ${mics.length + 1}` });
      }
    }
  } catch {
    // enumeração bloqueada — seletor simplesmente não aparece
  }
  return { cams, mics };
}

// ——— Perfis de envio ———

export interface TierProfile {
  /** Vídeo é enviado neste degrau? (false = foto/inicial do outro lado) */
  video: boolean;
  /** Divisor de resolução aplicado no encoder (1 = 720p, 2 = 360p). */
  videoScale: number;
  videoMaxBitrate: number;
  audioMaxBitrate: number;
  /** Rótulo curto para o badge do tile. */
  label: string;
}

export const TIER_PROFILES: Record<QualityTier, TierProfile> = {
  0: {
    video: true,
    videoScale: 1,
    videoMaxBitrate: VIDEO_MAX_BITRATE,
    audioMaxBitrate: AUDIO_BITRATE_NORMAL,
    label: "HD",
  },
  1: {
    video: true,
    videoScale: VIDEO_SD_SCALE,
    videoMaxBitrate: VIDEO_SD_MAX_BITRATE,
    audioMaxBitrate: AUDIO_BITRATE_NORMAL,
    label: "SD",
  },
  2: {
    video: false,
    videoScale: 1,
    videoMaxBitrate: VIDEO_MAX_BITRATE,
    audioMaxBitrate: AUDIO_BITRATE_NORMAL,
    label: "Só voz",
  },
  3: {
    video: false,
    videoScale: 1,
    videoMaxBitrate: VIDEO_MAX_BITRATE,
    audioMaxBitrate: AUDIO_BITRATE_DEGRADED,
    label: "Voz básica",
  },
};

export function isQualityTier(n: unknown): n is QualityTier {
  return n === 0 || n === 1 || n === 2 || n === 3;
}

/** Ajusta a codificação de um sender (setParameters: sem renegociar, sem tocar
 *  no preview local — só o que SAI muda). */
async function setEncoding(
  sender: RTCRtpSender,
  patch: { maxBitrate: number; scaleResolutionDownBy?: number },
): Promise<void> {
  const params = sender.getParameters();
  if (patch.scaleResolutionDownBy !== undefined) {
    // A ESCADA decide a resolução (720p ou 360p). Sob aperto de rede o navegador
    // sacrifica quadros por segundo, não nitidez — para conversa gravada, um
    // 720p a 15 fps vale mais que um 360p borrado a 30 fps. (Firefox ignora.)
    params.degradationPreference = "maintain-resolution";
  }
  if (!params.encodings || params.encodings.length === 0) {
    params.encodings = [{}];
  }
  for (const enc of params.encodings) {
    enc.maxBitrate = patch.maxBitrate;
    if (patch.scaleResolutionDownBy !== undefined) {
      enc.scaleResolutionDownBy = patch.scaleResolutionDownBy;
    }
  }
  try {
    await sender.setParameters(params);
  } catch {
    // Alguns browsers rejeitam setParameters em estados transitórios; o próximo
    // tique do monitor tenta de novo.
  }
}

/**
 * Aplica o perfil de um degrau nos senders. `wantCam` = intenção do usuário
 * (câmera ligada); o degrau só pode DESLIGAR o vídeo, nunca ligar contra a vontade.
 */
export async function applyTierProfile(
  pc: RTCPeerConnection,
  localStream: MediaStream,
  tier: QualityTier,
  wantCam: boolean,
): Promise<void> {
  const profile = TIER_PROFILES[tier];
  const camTrack = localStream.getVideoTracks()[0];
  if (camTrack) camTrack.enabled = wantCam && profile.video;
  for (const sender of pc.getSenders()) {
    const kind = sender.track?.kind;
    if (kind === "video") {
      await setEncoding(sender, {
        maxBitrate: profile.videoMaxBitrate,
        scaleResolutionDownBy: profile.videoScale,
      });
    } else if (kind === "audio") {
      await setEncoding(sender, { maxBitrate: profile.audioMaxBitrate });
    }
  }
}

// ——— Monitor (a escada pura vive em @/lib/shared/ladder) ———

/** Fotografia do envio a cada amostra — o que está acontecendo DE FATO no
 *  encoder, para o badge não mentir (a escada diz o que queremos; isto diz o que é). */
export interface SendReport {
  tier: QualityTier;
  /** Altura do quadro que o encoder está mandando agora (ex.: 720, 360); null sem vídeo. */
  sentHeight: number | null;
  sentWidth: number | null;
  fps: number | null;
  limitedBy: LimitReason;
  bweBps: number | null;
  lossRatio: number;
  rttMs: number;
  /** Amostras boas seguidas exigidas para a próxima subida (anti pisca-pisca). */
  samplesToRecover: number;
}

function toLimitReason(v: unknown): LimitReason {
  return v === "bandwidth" || v === "cpu" || v === "none" ? v : v === undefined ? "none" : "other";
}

/**
 * Monitor: amostra getStats() a cada 2 s, alimenta a escada e avisa quando o
 * degrau muda. A métrica é o que o OUTRO lado reporta receber do que EU envio
 * (remote-inbound-rtp) + RTT e largura de banda estimada do par de candidatos +
 * a razão de limitação declarada pelo encoder: cada lado adapta o próprio envio.
 */
export class QualityMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly ladder = new QualityLadder();
  private lastPacketsSent = 0;
  private lastPacketsLost = 0;
  /** QA: degrau travado à mão; a automação fica suspensa até soltar. */
  private frozen = false;
  private last: SendReport | null = null;

  constructor(
    private readonly pc: RTCPeerConnection,
    private readonly onTier: (tier: QualityTier) => void,
    private readonly onReport?: (report: SendReport) => void,
  ) {}

  get tier(): QualityTier {
    return this.ladder.tier;
  }

  get lastReport(): SendReport | null {
    return this.last;
  }

  /** true quando o vídeo foi sacrificado (degraus 2 e 3). */
  get isDegraded(): boolean {
    return !TIER_PROFILES[this.ladder.tier].video;
  }

  /** Força um degrau (QA/e2e). `null` solta a trava e a automação retoma. */
  force(tier: QualityTier | null): void {
    if (tier === null) {
      this.frozen = false;
      return;
    }
    this.frozen = true;
    this.ladder.set(tier);
    this.onTier(tier);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.sample(), STATS_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async sample(): Promise<void> {
    let stats: RTCStatsReport;
    try {
      stats = await this.pc.getStats();
    } catch {
      return;
    }
    let rttMs = 0;
    let bwe: number | null = null;
    let packetsSent = 0;
    let packetsLost = 0;
    let sentHeight: number | null = null;
    let sentWidth: number | null = null;
    let fps: number | null = null;
    let limitedBy: LimitReason = "none";

    stats.forEach((report) => {
      const r = report as unknown as Record<string, unknown>;
      const type = r["type"];
      if (type === "candidate-pair" && r["state"] === "succeeded") {
        const rtt = r["currentRoundTripTime"];
        if (typeof rtt === "number") rttMs = Math.max(rttMs, rtt * 1000);
        const b = r["availableOutgoingBitrate"];
        if (typeof b === "number") bwe = bwe === null ? b : Math.max(bwe, b);
      }
      if (type === "outbound-rtp") {
        const sent = r["packetsSent"];
        if (typeof sent === "number") packetsSent += sent;
        if (r["kind"] === "video") {
          const h = r["frameHeight"];
          const w = r["frameWidth"];
          const f = r["framesPerSecond"];
          if (typeof h === "number" && h > 0) sentHeight = h;
          if (typeof w === "number" && w > 0) sentWidth = w;
          if (typeof f === "number") fps = Math.round(f);
          limitedBy = toLimitReason(r["qualityLimitationReason"]);
        }
      }
      if (type === "remote-inbound-rtp") {
        const lost = r["packetsLost"];
        if (typeof lost === "number") packetsLost += lost;
      }
    });

    const deltaSent = packetsSent - this.lastPacketsSent;
    const deltaLost = packetsLost - this.lastPacketsLost;
    this.lastPacketsSent = packetsSent;
    this.lastPacketsLost = packetsLost;
    if (deltaSent < MIN_DELTA_PACKETS) return; // pouco tráfego novo: amostra é ruído

    const lossRatio = Math.max(0, deltaLost) / (deltaSent + Math.max(0, deltaLost));
    // Sem vídeo saindo (degraus 2/3, câmera desligada) o encoder não é a razão.
    const videoOut = TIER_PROFILES[this.ladder.tier].video && sentHeight !== null;
    const sample: QualitySample = {
      lossRatio,
      rttMs,
      bweBps: bwe ?? undefined,
      limitedBy: videoOut ? limitedBy : "none",
    };

    if (!this.frozen) {
      const next = this.ladder.feed(sample);
      if (next !== null) this.onTier(next);
    }

    this.last = {
      tier: this.ladder.tier,
      sentHeight: videoOut ? sentHeight : null,
      sentWidth: videoOut ? sentWidth : null,
      fps: videoOut ? fps : null,
      limitedBy: videoOut ? limitedBy : "none",
      bweBps: bwe,
      lossRatio,
      rttMs,
      samplesToRecover: this.ladder.samplesToRecover,
    };
    this.onReport?.(this.last);
  }
}

/** Redimensiona a foto de perfil no cliente (nunca sobe ao servidor). */
export async function shrinkImage(file: File, maxSide: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D indisponível.");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Falha ao gerar imagem."))),
      "image/jpeg",
      0.85,
    );
  });
}
