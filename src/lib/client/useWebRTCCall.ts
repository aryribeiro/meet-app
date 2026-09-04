"use client";

// Camada CONNECTION + orquestração: RTCPeerConnection com perfect negotiation,
// ICE restart, SAS, DataChannel tipado, monitor de qualidade e ciclo de vida do
// polling (dorme quando conecta — contrato).
import { useCallback, useEffect, useRef, useState } from "react";
import { SignalingChannel, endRoom, type SignalPayload } from "./signaling";
import { TypedChannel, type MediaStatePayload, type ProfilePayload } from "./channels";
import { sasFromConnection } from "./sas";
import {
  QualityMonitor,
  TIER_PROFILES,
  applyTierProfile,
  isQualityTier,
  type SendReport,
} from "./media";
import { TIER_AUDIO_HD, TIER_HD, type QualityTier } from "@/lib/shared/constants";

declare global {
  interface Window {
    /** Gancho de QA: força o degrau de qualidade que EU envio (mesmo efeito de
     *  desligar a própria câmera — não há superfície nova). `null` solta. */
    __meetQA?: {
      forceTier: (tier: QualityTier | null) => void;
      getTier: () => QualityTier;
      /** Última amostra do monitor: resolução enviada, razão de limitação, BWE, perda, RTT. */
      getReport: () => SendReport | null;
      /** Resolução/fps que a câmera está entregando (getSettings do track). */
      getCapture: () => { width?: number; height?: number; frameRate?: number } | null;
      /** O que o encoder está aplicando de fato (prova de que setParameters pegou). */
      getEncodings: () => {
        video: { scale: number | undefined; maxBitrate: number | undefined } | null;
        audio: { maxBitrate: number | undefined } | null;
      };
    };
  }
}

export type CallState =
  | "waiting" // aguardando o outro participante
  | "connecting"
  | "connected"
  | "reconnecting"
  | "ended"
  | "timeout"
  | "expired"
  // A rede bloqueou o caminho direto (CGNAT/VPN/firewall) e não há TURN que
  // salve — estado terminal com explicação honesta, nunca "reconectando" eterno.
  | "p2p-failed";

export interface RemoteProfile {
  name: string;
  photoUrl: string | null;
}

export interface UseWebRTCCallArgs {
  roomId: string;
  token: string;
  role: "host" | "guest";
  localName: string;
  localPhoto: Blob | null;
  localStream: MediaStream;
  startWithVideo: boolean;
  iceServers: RTCIceServer[];
  relayOnly: boolean;
}

export interface UseWebRTCCallResult {
  state: CallState;
  remoteStream: MediaStream | null;
  remoteProfile: RemoteProfile;
  remoteMedia: MediaStatePayload;
  sas: string | null;
  micOn: boolean;
  camOn: boolean;
  speakerOn: boolean;
  /** true quando NOSSO vídeo foi degradado para foto por qualidade de rede. */
  localFallback: boolean;
  /** Degrau da escada em que estamos ENVIANDO (0 HD, 1 SD, 2 só voz, 3 voz básica). */
  localTier: QualityTier;
  /** Degrau em que o outro lado está enviando (derivado de `fallback` se ele for antigo). */
  remoteTier: QualityTier;
  /** O que NOSSO encoder está mandando de fato (atualiza a cada 2 s). */
  localReport: SendReport | null;
  toggleMic: () => void;
  toggleCam: () => Promise<void>;
  toggleSpeaker: () => void;
  /** Troca microfone/câmera DURANTE a chamada (replaceTrack — sem renegociar). */
  switchMic: (deviceId: string) => Promise<boolean>;
  switchCam: (deviceId: string) => Promise<boolean>;
  /** Incrementa quando os tracks locais mudam — força o <video> local a ressincronizar. */
  streamEpoch: number;
  hangUp: () => Promise<void>;
}

export function useWebRTCCall(args: UseWebRTCCallArgs): UseWebRTCCallResult {
  const [state, setState] = useState<CallState>("waiting");
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [remoteProfile, setRemoteProfile] = useState<RemoteProfile>({
    name: "Participante",
    photoUrl: null,
  });
  const [remoteMedia, setRemoteMedia] = useState<MediaStatePayload>({
    camOn: true,
    micOn: true,
    fallback: false,
  });
  const [sas, setSas] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(args.startWithVideo);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [localFallback, setLocalFallback] = useState(false);
  const [localTier, setLocalTier] = useState<QualityTier>(TIER_HD);
  const [localReport, setLocalReport] = useState<SendReport | null>(null);
  const [streamEpoch, setStreamEpoch] = useState(0);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const signalingRef = useRef<SignalingChannel | null>(null);
  const channelRef = useRef<TypedChannel | null>(null);
  const monitorRef = useRef<QualityMonitor | null>(null);
  // camOn "desejado pelo usuário" — o fallback de qualidade não sobrescreve a intenção.
  const wantCamRef = useRef(args.startWithVideo);
  const endedRef = useRef(false);
  // Já conectou alguma vez? Falha antes da 1ª conexão = rede bloqueando (fatal);
  // falha depois = oscilação (tenta ICE restart).
  const everConnectedRef = useRef(false);
  const failCountRef = useRef(0);
  const hardFailedRef = useRef(false);

  const sendMediaState = useCallback(() => {
    const pc = pcRef.current;
    const camTrack = args.localStream.getVideoTracks()[0];
    const micTrack = args.localStream.getAudioTracks()[0];
    channelRef.current?.send("media-state", {
      camOn: camTrack?.enabled ?? false,
      micOn: micTrack?.enabled ?? false,
      fallback: monitorRef.current?.isDegraded ?? false,
      tier: monitorRef.current?.tier ?? TIER_HD,
    } satisfies MediaStatePayload);
    void pc; // estado é lido dos tracks locais
  }, [args.localStream]);

  useEffect(() => {
    let disposed = false;
    const polite = args.role === "guest"; // determinístico: convidado cede no glare
    let makingOffer = false;
    let ignoreOffer = false;

    const pc = new RTCPeerConnection({
      iceServers: args.iceServers,
      // relay-only: esconde o IP de cada peer do outro (todo tráfego via TURN).
      iceTransportPolicy: args.relayOnly ? "relay" : "all",
    });
    pcRef.current = pc;

    // Watchdog do primeiro handshake: peer entrou e a conexão P2P não fechou em
    // 75 s → rede bloqueando (CGNAT/VPN). Vira estado terminal explicado.
    let connectWatchdog: ReturnType<typeof setTimeout> | null = null;

    const signaling = new SignalingChannel({
      roomId: args.roomId,
      token: args.token,
      onPeerJoined: () => {
        if (disposed) return;
        setState((s) => (s === "waiting" ? "connecting" : s));
        if (!connectWatchdog && !everConnectedRef.current) {
          connectWatchdog = setTimeout(() => {
            if (!disposed && !everConnectedRef.current && !endedRef.current) {
              hardFailedRef.current = true;
              setState("p2p-failed");
              signaling.close();
            }
          }, 75_000);
        }
      },
      onDead: (reason) => {
        if (!disposed) setState(reason === "timeout" ? "timeout" : "expired");
      },
      onMessage: (payload: SignalPayload) => void handleSignal(payload),
    });
    signalingRef.current = signaling;

    // DataChannel simétrico (negotiated): os dois lados criam o mesmo canal id 0.
    const dc = pc.createDataChannel("meet", { negotiated: true, id: 0 });
    const channel = new TypedChannel();
    channel.attach(dc);
    channelRef.current = channel;

    channel.on("profile", (payload) => {
      const p = payload as ProfilePayload;
      if (typeof p?.name === "string" && p.name.trim()) {
        setRemoteProfile((prev) => ({ ...prev, name: p.name.trim().slice(0, 40) }));
      }
    });
    channel.on("media-state", (payload) => {
      const m = payload as MediaStatePayload;
      setRemoteMedia({
        camOn: Boolean(m?.camOn),
        micOn: Boolean(m?.micOn),
        fallback: Boolean(m?.fallback),
        tier: isQualityTier(m?.tier) ? m.tier : undefined,
      });
    });
    channel.on("bye", () => {
      endedRef.current = true;
      setState("ended");
    });
    channel.onFile("avatar", (_meta, blob) => {
      const url = URL.createObjectURL(blob);
      setRemoteProfile((prev) => {
        if (prev.photoUrl) URL.revokeObjectURL(prev.photoUrl);
        return { ...prev, photoUrl: url };
      });
    });

    for (const track of args.localStream.getTracks()) {
      pc.addTrack(track, args.localStream);
    }
    // Respeita o modo escolhido na pré-chamada (só mic, ou câmera+mic).
    const vt = args.localStream.getVideoTracks()[0];
    if (vt) vt.enabled = args.startWithVideo;

    pc.ontrack = (ev) => {
      const stream = ev.streams[0];
      if (stream) setRemoteStream(stream);
    };

    // ——— Perfect negotiation (padrão W3C) ———
    pc.onnegotiationneeded = async () => {
      try {
        makingOffer = true;
        await pc.setLocalDescription();
        signaling.wake(); // renegociação reabre o polling
        if (pc.localDescription) {
          await signaling.post({ kind: "description", description: pc.localDescription });
        }
      } catch (err) {
        console.debug("[webrtc] negotiationneeded falhou", err);
      } finally {
        makingOffer = false;
      }
    };

    pc.onicecandidate = (ev) => {
      void signaling.post({ kind: "candidate", candidate: ev.candidate?.toJSON() ?? null });
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed" && !hardFailedRef.current) {
        // ICE restart automático (contrato) — reabre polling para os novos candidates.
        signaling.wake();
        pc.restartIce();
      }
    };

    pc.onconnectionstatechange = () => {
      if (disposed) return;
      switch (pc.connectionState) {
        case "connected": {
          everConnectedRef.current = true;
          failCountRef.current = 0;
          if (connectWatchdog) {
            clearTimeout(connectWatchdog);
            connectWatchdog = null;
          }
          setState("connected");
          // Polling DORME: economiza invocações (contrato). Reacorda só em renegociação.
          signaling.sleep();
          void (async () => {
            setSas(await sasFromConnection(pc));
            await applyTierProfile(
              pc,
              args.localStream,
              monitorRef.current?.tier ?? TIER_HD,
              wantCamRef.current,
            );
          })();
          // Troca perfil + foto (só via DataChannel — nunca pelo servidor).
          channel.send("profile", { name: args.localName } satisfies ProfilePayload);
          if (args.localPhoto) void channel.sendBlob("avatar", args.localPhoto);
          sendMediaState();
          monitorRef.current?.start();
          break;
        }
        case "disconnected":
          setState("reconnecting");
          break;
        case "failed":
          failCountRef.current += 1;
          // Nunca conectou e já falhou 2x: a rede está bloqueando o caminho
          // direto — parar de fingir que "reconectando" vai resolver.
          if (!everConnectedRef.current && failCountRef.current >= 2) {
            hardFailedRef.current = true;
            setState("p2p-failed");
            signaling.close();
            break;
          }
          setState("reconnecting");
          signaling.wake();
          pc.restartIce();
          break;
        case "closed":
          if (!endedRef.current) setState("ended");
          break;
        default:
          break;
      }
    };

    async function handleSignal(payload: SignalPayload): Promise<void> {
      try {
        if (payload.kind === "bye") {
          endedRef.current = true;
          setState("ended");
          return;
        }
        if (payload.kind === "description") {
          const description = payload.description;
          const offerCollision =
            description.type === "offer" && (makingOffer || pc.signalingState !== "stable");
          ignoreOffer = !polite && offerCollision;
          if (ignoreOffer) return; // impolite descarta; polite faz rollback implícito
          await pc.setRemoteDescription(description);
          if (description.type === "offer") {
            await pc.setLocalDescription();
            if (pc.localDescription) {
              await signaling.post({ kind: "description", description: pc.localDescription });
            }
          }
          return;
        }
        if (payload.kind === "candidate") {
          try {
            await pc.addIceCandidate(payload.candidate ?? undefined);
          } catch (err) {
            if (!ignoreOffer) throw err;
          }
        }
      } catch (err) {
        console.debug("[webrtc] sinal descartado", err);
      }
    }

    // Escada de qualidade: 720p → SD → só voz HD → voz básica, e volta um degrau
    // por vez, com histerese (limiares no constants.ts, definidos no contrato).
    // Só o que ENVIAMOS muda; o preview local segue em 720p.
    const monitor = new QualityMonitor(
      pc,
      (tier) => {
        setLocalTier(tier);
        setLocalFallback(!TIER_PROFILES[tier].video);
        void applyTierProfile(pc, args.localStream, tier, wantCamRef.current).then(sendMediaState);
      },
      (report) => {
        if (!disposed) setLocalReport(report);
      },
    );
    monitorRef.current = monitor;
    window.__meetQA = {
      forceTier: (tier) => monitor.force(tier),
      getTier: () => monitor.tier,
      getReport: () => monitor.lastReport,
      getCapture: () => {
        const t = args.localStream.getVideoTracks()[0];
        if (!t) return null;
        const s = t.getSettings();
        return { width: s.width, height: s.height, frameRate: s.frameRate };
      },
      getEncodings: () => {
        let video: { scale: number | undefined; maxBitrate: number | undefined } | null = null;
        let audio: { maxBitrate: number | undefined } | null = null;
        for (const s of pc.getSenders()) {
          const enc = s.getParameters().encodings?.[0];
          if (s.track?.kind === "video") {
            video = { scale: enc?.scaleResolutionDownBy, maxBitrate: enc?.maxBitrate };
          } else if (s.track?.kind === "audio") {
            audio = { maxBitrate: enc?.maxBitrate };
          }
        }
        return { video, audio };
      },
    };

    signaling.wake();

    // Fechar a aba = sair da reunião (o link é efêmero por contrato).
    // persisted=true significa "página indo para o cache de navegação" — no
    // celular isso dispara ao trocar de app/apagar a tela; NÃO é sair da
    // reunião, então não derrubamos a sala nesses casos.
    const onPageHide = (ev: PageTransitionEvent) => {
      if (ev.persisted) return;
      channel.send("bye", {});
      void signaling.post({ kind: "bye" });
      void endRoom(args.roomId, args.token);
    };
    window.addEventListener("pagehide", onPageHide);

    return () => {
      disposed = true;
      if (connectWatchdog) clearTimeout(connectWatchdog);
      window.removeEventListener("pagehide", onPageHide);
      delete window.__meetQA;
      monitor.stop();
      signaling.close();
      pc.close();
      pcRef.current = null;
    };
    // args são estáveis por montagem da chamada (a página monta o hook uma vez).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args.roomId, args.token, args.role, args.relayOnly]);

  const toggleMic = useCallback(() => {
    const track = args.localStream.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMicOn(track.enabled);
    sendMediaState();
  }, [args.localStream, sendMediaState]);

  const toggleCam = useCallback(async () => {
    let track = args.localStream.getVideoTracks()[0];
    if (!track) {
      // Entrou só com microfone e ligou a câmera agora: captura tardia + addTrack.
      // A renegociação disparada é coberta pelo perfect negotiation.
      try {
        const cam = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
        });
        track = cam.getVideoTracks()[0];
      } catch {
        return; // permissão negada — mantém só áudio
      }
      if (!track) return;
      args.localStream.addTrack(track);
      pcRef.current?.addTrack(track, args.localStream);
      wantCamRef.current = true;
      setCamOn(true);
      setStreamEpoch((e) => e + 1);
      if (pcRef.current) {
        void applyTierProfile(
          pcRef.current,
          args.localStream,
          monitorRef.current?.tier ?? TIER_HD,
          true,
        );
      }
      sendMediaState();
      return;
    }
    wantCamRef.current = !wantCamRef.current;
    track.enabled = wantCamRef.current && !(monitorRef.current?.isDegraded ?? false);
    setCamOn(wantCamRef.current);
    sendMediaState();
  }, [args.localStream, sendMediaState]);

  const toggleSpeaker = useCallback(() => {
    setSpeakerOn((s) => !s);
  }, []);

  /**
   * Troca de dispositivo a quente: captura o novo track, faz replaceTrack no
   * sender (sem renegociação — o outro lado nem percebe), preserva o estado de
   * mute/câmera desligada e derruba o track antigo.
   */
  const switchDevice = useCallback(
    async (kind: "audio" | "video", deviceId: string): Promise<boolean> => {
      const pc = pcRef.current;
      let captured: MediaStream;
      try {
        captured = await navigator.mediaDevices.getUserMedia(
          kind === "audio"
            ? {
                audio: {
                  deviceId: { exact: deviceId },
                  echoCancellation: true,
                  noiseSuppression: true,
                  autoGainControl: true,
                },
              }
            : {
                video: {
                  deviceId: { exact: deviceId },
                  width: { ideal: 1280 },
                  height: { ideal: 720 },
                },
              },
        );
      } catch {
        return false; // dispositivo ocupado/removido — mantém o atual
      }
      const newTrack =
        kind === "audio" ? captured.getAudioTracks()[0] : captured.getVideoTracks()[0];
      if (!newTrack) return false;

      const old =
        kind === "audio"
          ? args.localStream.getAudioTracks()[0]
          : args.localStream.getVideoTracks()[0];

      // Preserva a intenção do usuário: mute segue mutado, câmera desligada segue desligada.
      newTrack.enabled = old
        ? old.enabled
        : kind === "video"
          ? wantCamRef.current && !(monitorRef.current?.isDegraded ?? false)
          : true;

      if (old) {
        const sender = pc?.getSenders().find((s) => s.track === old);
        if (sender) await sender.replaceTrack(newTrack);
        args.localStream.removeTrack(old);
        old.stop();
        args.localStream.addTrack(newTrack);
      } else {
        // Não havia track desse tipo (entrou só com voz): adiciona — a
        // renegociação disparada é coberta pelo perfect negotiation.
        args.localStream.addTrack(newTrack);
        pc?.addTrack(newTrack, args.localStream);
      }

      // O sender novo (ou o track trocado) precisa do perfil do degrau atual.
      if (pc) {
        void applyTierProfile(
          pc,
          args.localStream,
          monitorRef.current?.tier ?? TIER_HD,
          wantCamRef.current,
        );
      }
      setStreamEpoch((e) => e + 1);
      sendMediaState();
      return true;
    },
    [args.localStream, sendMediaState],
  );

  const switchMic = useCallback(
    (deviceId: string) => switchDevice("audio", deviceId),
    [switchDevice],
  );
  const switchCam = useCallback(
    (deviceId: string) => switchDevice("video", deviceId),
    [switchDevice],
  );

  const hangUp = useCallback(async () => {
    endedRef.current = true;
    channelRef.current?.send("bye", {});
    await signalingRef.current?.post({ kind: "bye" });
    await endRoom(args.roomId, args.token);
    pcRef.current?.close();
    setState("ended");
  }, [args.roomId, args.token]);

  return {
    state,
    remoteStream,
    remoteProfile,
    remoteMedia,
    sas,
    micOn,
    camOn,
    speakerOn,
    localFallback,
    localTier,
    localReport,
    remoteTier: isQualityTier(remoteMedia.tier)
      ? remoteMedia.tier
      : remoteMedia.fallback
        ? TIER_AUDIO_HD
        : TIER_HD,
    toggleMic,
    toggleCam,
    toggleSpeaker,
    switchMic,
    switchCam,
    streamEpoch,
    hangUp,
  };
}
