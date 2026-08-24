"use client";

// Tela de pré-chamada: perfil (nome + foto de fallback), preview de câmera/mic,
// escolha do modo de entrada (só voz ou vídeo) e senha da sala quando exigida.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getLocalMedia,
  listDevices,
  shrinkImage,
  type MediaDeviceOption,
} from "@/lib/client/media";
import { AVATAR_MAX_SIDE } from "@/lib/shared/constants";
import { Avatar } from "./Avatar";
import { DevicePicker } from "./DevicePicker";

export interface PreCallResult {
  name: string;
  photo: Blob | null;
  stream: MediaStream;
  withVideo: boolean;
  password: string;
  relayOnly: boolean;
}

export function PreCall({
  requiresPassword,
  relayAvailable,
  errorMessage,
  onJoin,
}: {
  requiresPassword: boolean;
  relayAvailable: boolean;
  errorMessage: string | null;
  onJoin: (result: PreCallResult) => void;
}) {
  const [name, setName] = useState("");
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [withVideo, setWithVideo] = useState(true);
  const [relayOnly, setRelayOnly] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [devices, setDevices] = useState<{ cams: MediaDeviceOption[]; mics: MediaDeviceOption[] }>(
    { cams: [], mics: [] },
  );
  const [micId, setMicId] = useState("");
  const [camId, setCamId] = useState("");
  const [joining, setJoining] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Fluxo entregue à chamada: a limpeza do unmount NÃO pode pará-lo — foi o bug
  // da "câmera preta" (preview ok, chamada com tracks já encerrados).
  const handedOffRef = useRef<MediaStream | null>(null);

  // Captura o preview conforme o modo escolhido; tracks antigos são parados
  // (câmera desliga de verdade quando o modo é "só voz").
  useEffect(() => {
    let cancelled = false;
    let current: MediaStream | null = null;
    setMediaError(null);
    getLocalMedia(withVideo, { micId: micId || undefined, camId: camId || undefined })
      .then((s) => {
        if (cancelled) {
          for (const t of s.getTracks()) t.stop();
          return;
        }
        current = s;
        setStream((prev) => {
          if (prev) for (const t of prev.getTracks()) t.stop();
          return s;
        });
        // Rótulos dos dispositivos só existem após a permissão — enumera agora.
        void listDevices().then((d) => {
          if (!cancelled) setDevices(d);
        });
      })
      .catch(() => {
        if (!cancelled) {
          setMediaError(
            withVideo
              ? "Não conseguimos usar sua câmera ou microfone. Verifique as permissões do navegador."
              : "Não conseguimos usar seu microfone. Verifique as permissões do navegador.",
          );
        }
      });
    return () => {
      cancelled = true;
      // Só desliga a câmera/mic se o fluxo NÃO foi entregue à chamada.
      if (current && current !== handedOffRef.current) {
        for (const t of current.getTracks()) t.stop();
      }
    };
  }, [withVideo, micId, camId]);

  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    if (joining) setJoining(false);
    // Entrada recusada: o fluxo continua conosco — a limpeza volta a ser nossa.
    handedOffRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reabilita o botão quando o servidor recusa
  }, [errorMessage]);

  const pickPhoto = useCallback(async (file: File | undefined) => {
    if (!file) return;
    try {
      const blob = await shrinkImage(file, AVATAR_MAX_SIDE);
      setPhoto(blob);
      setPhotoUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
    } catch {
      // imagem inválida — mantém sem foto
    }
  }, []);

  const canJoin =
    name.trim().length > 0 &&
    stream !== null &&
    !joining &&
    (!requiresPassword || password.length > 0);

  return (
    <div className="mx-auto w-full max-w-lg space-y-6 rounded-2xl border border-[color:var(--color-line)] bg-[color:var(--color-panel)] p-6">
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-bold">Quase lá!</h1>
        <p className="text-sm text-[color:var(--color-ink-dim)]">
          Ajuste como você quer aparecer antes de entrar.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl bg-black">
        {withVideo && stream ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="mirror aspect-video w-full object-cover"
          />
        ) : (
          <div className="flex aspect-video w-full items-center justify-center">
            <Avatar name={name || "?"} photoUrl={photoUrl} size={96} />
          </div>
        )}
      </div>
      {mediaError && <p className="text-sm text-[color:var(--color-danger)]">{mediaError}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setWithVideo(true)}
          className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${withVideo ? "border-[color:var(--color-brand)] bg-[color:var(--color-brand-soft)] text-[color:var(--color-ink)]" : "border-[color:var(--color-line)] text-[color:var(--color-ink-dim)]"}`}
        >
          📹 Vídeo e voz
        </button>
        <button
          type="button"
          onClick={() => setWithVideo(false)}
          className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${!withVideo ? "border-[color:var(--color-brand)] bg-[color:var(--color-brand-soft)] text-[color:var(--color-ink)]" : "border-[color:var(--color-line)] text-[color:var(--color-ink-dim)]"}`}
        >
          🎙️ Só voz
        </button>
      </div>

      {(devices.mics.length > 1 || (withVideo && devices.cams.length > 1)) && (
        <DevicePicker
          cams={devices.cams}
          mics={devices.mics}
          camId={camId || (stream?.getVideoTracks()[0]?.getSettings().deviceId ?? "")}
          micId={micId || (stream?.getAudioTracks()[0]?.getSettings().deviceId ?? "")}
          showCamera={withVideo}
          onCam={setCamId}
          onMic={setMicId}
        />
      )}

      <div className="space-y-3">
        <label className="block space-y-1">
          <span className="text-sm text-[color:var(--color-ink-dim)]">Seu nome</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            placeholder="Como o outro vai te ver"
            className="w-full rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-panel-2)] px-4 py-3 outline-none transition focus:border-[color:var(--color-brand)]"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm text-[color:var(--color-ink-dim)]">
            Foto (aparece se seu vídeo cair) — opcional
          </span>
          <div className="flex items-center gap-3">
            <Avatar name={name || "?"} photoUrl={photoUrl} size={48} />
            <input
              type="file"
              accept="image/*"
              onChange={(e) => void pickPhoto(e.target.files?.[0])}
              className="text-sm text-[color:var(--color-ink-dim)] file:mr-3 file:rounded-lg file:border-0 file:bg-[color:var(--color-panel-2)] file:px-3 file:py-2 file:text-[color:var(--color-ink)]"
            />
          </div>
          <span className="block text-xs text-[color:var(--color-ink-dim)]">
            Sua foto vai direto para o outro participante — nunca para nossos servidores.
          </span>
        </label>

        {requiresPassword && (
          <label className="block space-y-1">
            <span className="text-sm text-[color:var(--color-ink-dim)]">Senha da sala</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Pedida por quem convidou você"
              className="w-full rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-panel-2)] px-4 py-3 outline-none transition focus:border-[color:var(--color-brand)]"
            />
          </label>
        )}

        {relayAvailable && (
          <label className="flex items-start gap-2 text-sm text-[color:var(--color-ink-dim)]">
            <input
              type="checkbox"
              checked={relayOnly}
              onChange={(e) => setRelayOnly(e.target.checked)}
              className="mt-1"
            />
            <span>
              Privacidade extra: esconder meu endereço de internet do outro participante
              (a chamada pode ficar um pouco mais lenta).
            </span>
          </label>
        )}
      </div>

      {errorMessage && (
        <p className="rounded-lg border border-[color:var(--color-danger)] bg-red-950/40 px-4 py-3 text-sm text-[color:var(--color-danger)]">
          {errorMessage}
        </p>
      )}

      <button
        type="button"
        disabled={!canJoin}
        onClick={() => {
          if (!stream) return;
          setJoining(true);
          handedOffRef.current = stream;
          onJoin({ name: name.trim(), photo, stream, withVideo, password, relayOnly });
        }}
        className="w-full rounded-lg bg-[color:var(--color-brand)] py-3 text-lg font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
      >
        {joining ? "Entrando…" : "Entrar na conversa"}
      </button>
    </div>
  );
}
