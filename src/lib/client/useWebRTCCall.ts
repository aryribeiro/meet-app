"use client";

// Camada CONNECTION + orquestração: RTCPeerConnection com perfect negotiation,
// ICE restart, SAS, DataChannel tipado, monitor de qualidade e ciclo de vida do
// polling (dorme quando conecta — contrato).
import { useCallback, useEffect, useRef, useState } from "react";
import { SignalingChannel, endRoom, type SignalPayload } from "./signaling";
import {
  TypedChannel,
  type MediaStatePayload,
  type ProfilePayload,
  type ScreenPayload,
} from "./channels";
import { sasFromConnection } from "./sas";
import {
  QualityMonitor,
  TIER_PROFILES,
  applyTierProfile,
  isQualityTier,
  type SendReport,
} from "./media";
import {
  CHAT_MAX_MESSAGES,
  SCREEN_FRAME_RATE,
  TIER_AUDIO_HD,
  TIER_HD,
  type QualityTier,
} from "@/lib/shared/constants";
import {
  checkFile,
  newChatId,
  parseChatPayload,
  sanitizeChatText,
  type ChatMessage,
  type ChatPayload,
} from "@/lib/shared/chat";

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
      /** QA: compartilha um canvas de cor sólida como se fosse a tela (mesmo caminho
       *  do getDisplayMedia, menos o diálogo do navegador). */
      shareTestScreen: (color: string) => Promise<void>;
      stopScreen: () => void;
      /** Polling de sinalização ligado? Deve ser false em chamada estável. */
      isPolling: () => boolean;
      /** QA: manda um arquivo PULANDO a checagem do remetente — prova a guarda do receptor. */
      sendRawFile: (name: string, size: number) => Promise<boolean>;
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
  /** Webchat: mensagens desta chamada (efêmeras, só em memória). */
  chat: ChatMessage[];
  /** Envia texto pelo canal direto. Devolve false se não havia nada a enviar. */
  sendChat: (text: string) => boolean;
  /** Envia um arquivo pelo canal direto (allowlist + teto conferidos antes). */
  sendFile: (file: File) => Promise<{ ok: boolean; reason?: string }>;
  /** Apresentação de tela. `screenShareSupported` = o navegador tem getDisplayMedia. */
  screenShareSupported: boolean;
  localScreenStream: MediaStream | null;
  remoteScreenStream: MediaStream | null;
  /** Abre o diálogo do navegador (ou usa `stream` se dado) e envia a tela. false = cancelado/negado. */
  startScreenShare: (stream?: MediaStream) => Promise<boolean>;
  stopScreenShare: () => void;
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
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [screenShareSupported, setScreenShareSupported] = useState(false);
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
  const [remoteScreenStream, setRemoteScreenStream] = useState<MediaStream | null>(null);
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);
  const screenSenderRef = useRef<RTCRtpSender | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  // Fluxos remotos: o id do fluxo da câmera, o id anunciado como tela e os que
  // chegaram antes do anúncio (a ordem entre DataChannel e ontrack não é garantida).
  const remoteCamIdRef = useRef<string | null>(null);
  const remoteScreenIdRef = useRef<string | null>(null);
  const pendingRemoteRef = useRef(new Map<string, MediaStream>());
  useEffect(() => {
    setScreenShareSupported(
      typeof navigator !== "undefined" &&
        typeof navigator.mediaDevices?.getDisplayMedia === "function",
    );
  }, []);
  const pushChat = useCallback((msg: ChatMessage) => {
    setChat((prev) => {
      const next = [...prev, msg];
      return next.length > CHAT_MAX_MESSAGES ? next.slice(next.length - CHAT_MAX_MESSAGES) : next;
    });
  }, []);
  const patchChat = useCallback((id: string, patch: (m: ChatMessage) => ChatMessage) => {
    setChat((prev) => prev.map((m) => (m.id === id ? patch(m) : m)));
  }, []);
  // URLs de objeto dos arquivos recebidos: morrem com a chamada.
  const objectUrlsRef = useRef<string[]>([]);
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
    // Webchat: o que vem do outro lado é entrada hostil — validado em forma,
    // tamanho e caracteres antes de tocar a tela; inválido é descartado em silêncio.
    channel.on("chat", (payload) => {
      const msg = parseChatPayload(payload);
      if (msg) pushChat({ ...msg, from: "peer" });
    });
    // Arquivos do outro lado: o cabeçalho passa pela MESMA checagem do remetente
    // (nome sanitizado, extensão na allowlist, teto). Recusado = pedaços descartados.
    channel.onFileGate("file", (meta) => {
      if (typeof meta.id !== "string" || meta.id.length === 0 || meta.id.length > 32) return false;
      const r = checkFile(typeof meta.name === "string" ? meta.name : "", meta.size);
      if (!r.ok) return false;
      pushChat({
        id: `f-${meta.id}`,
        text: r.name,
        at: Date.now(),
        from: "peer",
        file: { size: meta.size, bytes: 0, status: "receiving" },
      });
      return true;
    });
    channel.onFileProgress("file", (meta, received) => {
      patchChat(`f-${meta.id}`, (m) => (m.file ? { ...m, file: { ...m.file, bytes: received } } : m));
    });
    channel.onFile("file", (meta, blob) => {
      const url = URL.createObjectURL(blob);
      objectUrlsRef.current.push(url);
      patchChat(`f-${meta.id}`, (m) =>
        m.file ? { ...m, file: { ...m.file, bytes: meta.size, status: "done", url } } : m,
      );
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
      if (!stream) return;
      if (stream.id === remoteScreenIdRef.current) {
        setRemoteScreenStream(stream);
        return;
      }
      if (remoteCamIdRef.current === null || stream.id === remoteCamIdRef.current) {
        remoteCamIdRef.current = stream.id;
        setRemoteStream(stream);
        return;
      }
      // Fluxo extra ainda sem propósito anunciado: guarda até a mensagem "screen".
      pendingRemoteRef.current.set(stream.id, stream);
    };
    channel.on("screen", (payload) => {
      const p = payload as ScreenPayload;
      if (typeof p?.streamId !== "string") return;
      if (p.on) {
        remoteScreenIdRef.current = p.streamId;
        const pending = pendingRemoteRef.current.get(p.streamId);
        if (pending) {
          pendingRemoteRef.current.delete(p.streamId);
          setRemoteScreenStream(pending);
        }
      } else if (remoteScreenIdRef.current === p.streamId) {
        remoteScreenIdRef.current = null;
        pendingRemoteRef.current.delete(p.streamId);
        setRemoteScreenStream(null);
      }
    });

    // ——— Renegociação com polling que dorme ———
    // Depois de conectar, o polling DORME nos dois lados. Quem vai renegociar
    // (tela, câmera tardia) avisa o outro pelo canal direto ("wake") para ele
    // voltar a buscar sinalização; quando a negociação estabiliza, os dois
    // voltam a dormir após uma folga (candidates do m-line novo).
    let sleepTimer: ReturnType<typeof setTimeout> | null = null;
    const cancelSleep = () => {
      if (sleepTimer) {
        clearTimeout(sleepTimer);
        sleepTimer = null;
      }
    };
    const scheduleSleep = () => {
      cancelSleep();
      sleepTimer = setTimeout(() => {
        sleepTimer = null;
        if (!disposed && pc.connectionState === "connected" && pc.signalingState === "stable") {
          signaling.sleep();
        }
      }, 3000);
    };
    channel.on("wake", () => {
      cancelSleep();
      signaling.wake();
    });
    pc.onsignalingstatechange = () => {
      if (pc.signalingState === "stable" && everConnectedRef.current) scheduleSleep();
      else cancelSleep();
    };

    // ——— Perfect negotiation (padrão W3C) ———
    pc.onnegotiationneeded = async () => {
      try {
        makingOffer = true;
        if (everConnectedRef.current) channel.send("wake", {}); // acorda o polling do outro lado
        cancelSleep();
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
        void applyTierProfile(
          pc,
          args.localStream,
          tier,
          wantCamRef.current,
          screenTrackRef.current,
        ).then(sendMediaState);
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
      shareTestScreen: async (color) => {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 360;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const paint = () => {
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        };
        paint();
        const timer = setInterval(paint, 100); // quadros novos para o encoder ter o que mandar
        const stream = canvas.captureStream(10);
        stream.getVideoTracks()[0]?.addEventListener("ended", () => clearInterval(timer));
        await startScreenShareRef.current?.(stream);
      },
      stopScreen: () => stopScreenShareRef.current?.(),
      isPolling: () => signaling.isPolling,
      sendRawFile: (name, size) =>
        channel.sendBlob("file", new Blob([new Uint8Array(size)]), { name }),
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
      cancelSleep();
      window.removeEventListener("pagehide", onPageHide);
      delete window.__meetQA;
      screenTrackRef.current?.stop();
      screenTrackRef.current = null;
      for (const u of objectUrlsRef.current.splice(0)) URL.revokeObjectURL(u);
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

  // ——— Apresentação de tela ———
  const stopScreenShare = useCallback(() => {
    const track = screenTrackRef.current;
    const stream = screenStreamRef.current;
    const sender = screenSenderRef.current;
    if (!track || !stream) return;
    screenTrackRef.current = null;
    screenStreamRef.current = null;
    screenSenderRef.current = null;
    channelRef.current?.send("screen", { on: false, streamId: stream.id } satisfies ScreenPayload);
    try {
      if (sender) pcRef.current?.removeTrack(sender); // renegociação coberta pelo perfect negotiation
    } catch {
      // conexão já fechada
    }
    track.stop();
    monitorRef.current?.setScreenTrackId(null);
    setLocalScreenStream(null);
  }, []);

  const startScreenShare = useCallback(
    async (given?: MediaStream): Promise<boolean> => {
      const pc = pcRef.current;
      if (!pc || screenTrackRef.current) return false;
      let stream = given ?? null;
      if (!stream) {
        try {
          stream = await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: { ideal: SCREEN_FRAME_RATE, max: 30 } },
            audio: false,
          });
        } catch {
          return false; // cancelou o diálogo ou o navegador negou
        }
      }
      const track = stream.getVideoTracks()[0];
      if (!track) return false;
      // Texto e janelas: privilegiar nitidez sobre movimento.
      try {
        track.contentHint = "detail";
      } catch {
        // navegador sem contentHint — segue sem
      }
      screenTrackRef.current = track;
      screenStreamRef.current = stream;
      // Anunciar ANTES do track: o outro lado casa o id no ontrack.
      channelRef.current?.send("screen", { on: true, streamId: stream.id } satisfies ScreenPayload);
      screenSenderRef.current = pc.addTrack(track, stream);
      monitorRef.current?.setScreenTrackId(track.id);
      void applyTierProfile(
        pc,
        args.localStream,
        monitorRef.current?.tier ?? TIER_HD,
        wantCamRef.current,
        track,
      );
      // "Parar compartilhamento" do próprio navegador encerra o track.
      track.addEventListener("ended", () => {
        if (screenTrackRef.current === track) stopScreenShare();
      });
      setLocalScreenStream(stream);
      return true;
    },
    [args.localStream, stopScreenShare],
  );
  const startScreenShareRef = useRef(startScreenShare);
  const stopScreenShareRef = useRef(stopScreenShare);
  startScreenShareRef.current = startScreenShare;
  stopScreenShareRef.current = stopScreenShare;

  const sendFile = useCallback(
    async (file: File): Promise<{ ok: boolean; reason?: string }> => {
      const r = checkFile(file.name, file.size);
      if (!r.ok) return { ok: false, reason: r.reason };
      const channel = channelRef.current;
      if (!channel?.isOpen) return { ok: false, reason: "Sem conexão agora. Tente quando a conversa estabilizar." };
      const id = newChatId();
      pushChat({
        id,
        text: r.name,
        at: Date.now(),
        from: "me",
        delivered: true,
        file: { size: file.size, bytes: 0, status: "sending" },
      });
      const ok = await channel.sendBlob("file", file, {
        name: r.name,
        onProgress: (sent) =>
          patchChat(id, (m) => (m.file ? { ...m, file: { ...m.file, bytes: sent } } : m)),
      });
      patchChat(id, (m) =>
        m.file ? { ...m, file: { ...m.file, status: ok ? "done" : "failed", bytes: ok ? file.size : m.file.bytes } } : m,
      );
      return ok ? { ok: true } : { ok: false, reason: "A conexão caiu no meio do envio." };
    },
    [pushChat, patchChat],
  );

  const sendChat = useCallback((raw: string): boolean => {
    const text = sanitizeChatText(raw);
    if (!text) return false;
    const payload: ChatPayload = { id: newChatId(), text, at: Date.now() };
    // Entrega honesta: "enviada" só se o canal estava aberto agora; a fila do
    // TypedChannel só serve ao handshake inicial, não a uma reconexão.
    const delivered = channelRef.current?.isOpen ?? false;
    if (delivered) channelRef.current?.send("chat", payload);
    pushChat({ ...payload, from: "me", delivered });
    return true;
  }, [pushChat]);

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
    chat,
    sendChat,
    sendFile,
    screenShareSupported,
    localScreenStream,
    remoteScreenStream,
    startScreenShare,
    stopScreenShare,
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
