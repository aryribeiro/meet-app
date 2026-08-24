"use client";

// Camada CONNECTION + orquestração: RTCPeerConnection com perfect negotiation,
// ICE restart, SAS, DataChannel tipado, monitor de qualidade e ciclo de vida do
// polling (dorme quando conecta — contrato).
import { useCallback, useEffect, useRef, useState } from "react";
import { SignalingChannel, endRoom, type SignalPayload } from "./signaling";
import { TypedChannel, type MediaStatePayload, type ProfilePayload } from "./channels";
import { sasFromConnection } from "./sas";
import { QualityMonitor, applyAudioProfile, applyVideoCeiling } from "./media";

export type CallState =
  | "waiting" // aguardando o outro participante
  | "connecting"
  | "connected"
  | "reconnecting"
  | "ended"
  | "timeout"
  | "expired";

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
  const [streamEpoch, setStreamEpoch] = useState(0);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const signalingRef = useRef<SignalingChannel | null>(null);
  const channelRef = useRef<TypedChannel | null>(null);
  const monitorRef = useRef<QualityMonitor | null>(null);
  // camOn "desejado pelo usuário" — o fallback de qualidade não sobrescreve a intenção.
  const wantCamRef = useRef(args.startWithVideo);
  const endedRef = useRef(false);

  const sendMediaState = useCallback(() => {
    const pc = pcRef.current;
    const camTrack = args.localStream.getVideoTracks()[0];
    const micTrack = args.localStream.getAudioTracks()[0];
    channelRef.current?.send("media-state", {
      camOn: camTrack?.enabled ?? false,
      micOn: micTrack?.enabled ?? false,
      fallback: monitorRef.current?.isDegraded ?? false,
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

    const signaling = new SignalingChannel({
      roomId: args.roomId,
      token: args.token,
      onPeerJoined: () => {
        if (!disposed) setState((s) => (s === "waiting" ? "connecting" : s));
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
      if (pc.iceConnectionState === "failed") {
        // ICE restart automático (contrato) — reabre polling para os novos candidates.
        signaling.wake();
        pc.restartIce();
      }
    };

    pc.onconnectionstatechange = () => {
      if (disposed) return;
      switch (pc.connectionState) {
        case "connected": {
          setState("connected");
          // Polling DORME: economiza invocações (contrato). Reacorda só em renegociação.
          signaling.sleep();
          void (async () => {
            setSas(await sasFromConnection(pc));
            await applyVideoCeiling(pc);
            await applyAudioProfile(pc, monitorRef.current?.isDegraded ?? false);
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

    // Monitor de qualidade: degrada vídeo→foto e abaixa teto de áudio; recupera
    // com histerese (limiares no constants.ts, definidos no contrato).
    const monitor = new QualityMonitor(
      pc,
      () => {
        const track = args.localStream.getVideoTracks()[0];
        if (track) track.enabled = false;
        setLocalFallback(true);
        void applyAudioProfile(pc, true);
        sendMediaState();
      },
      () => {
        const track = args.localStream.getVideoTracks()[0];
        if (track && wantCamRef.current) track.enabled = true;
        setLocalFallback(false);
        void applyAudioProfile(pc, false);
        sendMediaState();
      },
    );
    monitorRef.current = monitor;

    signaling.wake();

    // Fechar a aba = sair da reunião (o link é efêmero por contrato).
    const onPageHide = () => {
      channel.send("bye", {});
      void signaling.post({ kind: "bye" });
      void endRoom(args.roomId, args.token);
    };
    window.addEventListener("pagehide", onPageHide);

    return () => {
      disposed = true;
      window.removeEventListener("pagehide", onPageHide);
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
      if (pcRef.current) void applyVideoCeiling(pcRef.current);
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

      if (pc) {
        if (kind === "video") void applyVideoCeiling(pc);
        else void applyAudioProfile(pc, monitorRef.current?.isDegraded ?? false);
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
    toggleMic,
    toggleCam,
    toggleSpeaker,
    switchMic,
    switchCam,
    streamEpoch,
    hangUp,
  };
}
