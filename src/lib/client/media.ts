// Camada MEDIA: captura, teto de bitrate e monitor de qualidade com histerese.
// Limiares definidos ANTES do código (PROMPT.md, emenda 3).
import {
  AUDIO_BITRATE_DEGRADED,
  AUDIO_BITRATE_NORMAL,
  DEGRADE_LOSS,
  DEGRADE_RTT_MS,
  DEGRADE_SAMPLES,
  RECOVER_LOSS,
  RECOVER_RTT_MS,
  RECOVER_SAMPLES,
  STATS_INTERVAL_MS,
  VIDEO_MAX_BITRATE,
} from "@/lib/shared/constants";

/** Captura com vídeo 720p (contrato) e processamento de voz ligado. */
export async function getLocalMedia(withVideo: boolean): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: withVideo
      ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" }
      : false,
  });
}

/** Aplica teto de bitrate num sender (áudio: Opus adapta sozinho abaixo do teto —
 *  decisão do contrato: não construir HD/não-HD manual; só mover o teto). */
export async function setMaxBitrate(
  sender: RTCRtpSender,
  maxBitrate: number,
): Promise<void> {
  const params = sender.getParameters();
  if (!params.encodings || params.encodings.length === 0) {
    params.encodings = [{}];
  }
  for (const enc of params.encodings) enc.maxBitrate = maxBitrate;
  try {
    await sender.setParameters(params);
  } catch {
    // Alguns browsers rejeitam setParameters em estados transitórios; o próximo
    // tique do monitor tenta de novo.
  }
}

export async function applyAudioProfile(
  pc: RTCPeerConnection,
  degraded: boolean,
): Promise<void> {
  for (const sender of pc.getSenders()) {
    if (sender.track?.kind === "audio") {
      await setMaxBitrate(sender, degraded ? AUDIO_BITRATE_DEGRADED : AUDIO_BITRATE_NORMAL);
    }
  }
}

export async function applyVideoCeiling(pc: RTCPeerConnection): Promise<void> {
  for (const sender of pc.getSenders()) {
    if (sender.track?.kind === "video") {
      await setMaxBitrate(sender, VIDEO_MAX_BITRATE);
    }
  }
}

export interface QualitySample {
  lossRatio: number;
  rttMs: number;
}

/**
 * Monitor com HISTERESE:
 * - degrada com perda > 8% OU RTT > 400 ms em 3 amostras consecutivas;
 * - recupera com perda < 2% E RTT < 250 ms em 5 amostras consecutivas.
 * Sem histerese o vídeo liga/desliga em rede oscilante — o defeito clássico.
 */
export class QualityMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private badStreak = 0;
  private goodStreak = 0;
  private degraded = false;
  private lastPacketsSent = 0;
  private lastPacketsLost = 0;

  constructor(
    private readonly pc: RTCPeerConnection,
    private readonly onDegrade: () => void,
    private readonly onRecover: () => void,
  ) {}

  get isDegraded(): boolean {
    return this.degraded;
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
    let packetsSent = 0;
    let packetsLost = 0;

    stats.forEach((report) => {
      const r = report as unknown as Record<string, unknown>;
      if (r["type"] === "candidate-pair" && r["state"] === "succeeded") {
        const rtt = r["currentRoundTripTime"];
        if (typeof rtt === "number") rttMs = Math.max(rttMs, rtt * 1000);
      }
      if (r["type"] === "outbound-rtp") {
        const sent = r["packetsSent"];
        if (typeof sent === "number") packetsSent += sent;
      }
      if (r["type"] === "remote-inbound-rtp") {
        const lost = r["packetsLost"];
        if (typeof lost === "number") packetsLost += lost;
      }
    });

    const deltaSent = packetsSent - this.lastPacketsSent;
    const deltaLost = packetsLost - this.lastPacketsLost;
    this.lastPacketsSent = packetsSent;
    this.lastPacketsLost = packetsLost;
    if (deltaSent <= 0) return; // sem tráfego novo, amostra inútil

    const lossRatio = Math.max(0, deltaLost) / (deltaSent + Math.max(0, deltaLost));
    const bad = lossRatio > DEGRADE_LOSS || rttMs > DEGRADE_RTT_MS;
    const good = lossRatio < RECOVER_LOSS && rttMs < RECOVER_RTT_MS;

    if (bad) {
      this.badStreak += 1;
      this.goodStreak = 0;
    } else if (good) {
      this.goodStreak += 1;
      this.badStreak = 0;
    } else {
      // zona morta da histerese: zera os dois — exige consistência real
      this.badStreak = 0;
      this.goodStreak = 0;
    }

    if (!this.degraded && this.badStreak >= DEGRADE_SAMPLES) {
      this.degraded = true;
      this.badStreak = 0;
      this.onDegrade();
    } else if (this.degraded && this.goodStreak >= RECOVER_SAMPLES) {
      this.degraded = false;
      this.goodStreak = 0;
      this.onRecover();
    }
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
