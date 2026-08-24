"use client";

// Tela de chamada, composta por painéis independentes (contrato: grid de mídia,
// faixa de avisos e barra de controles — chat/arquivos futuros entram como novos
// painéis, não como reescrita).
import { useEffect, useRef, useState } from "react";
import type { UseWebRTCCallResult } from "@/lib/client/useWebRTCCall";
import { listDevices, type MediaDeviceOption } from "@/lib/client/media";
import { Avatar } from "./Avatar";
import { DevicePicker } from "./DevicePicker";

function MediaTile({
  stream,
  showVideo,
  name,
  photoUrl,
  mirrored,
  muted,
  micOff,
  label,
  refreshKey = 0,
}: {
  stream: MediaStream | null;
  showVideo: boolean;
  name: string;
  photoUrl: string | null;
  mirrored: boolean;
  muted: boolean;
  micOff: boolean;
  label: string;
  /** Troca de dispositivo muda os tracks do MESMO MediaStream — o srcObject
   *  precisa ser reatribuído para o elemento enxergar o track novo. */
  refreshKey?: number;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream;
  }, [stream, refreshKey]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl bg-black">
      {/* O elemento de vídeo fica sempre montado: é ele que TOCA O ÁUDIO.
          Quando o vídeo cai/desliga, escondemos a imagem e mostramos a foto. */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        className={`${mirrored ? "mirror " : ""}h-full w-full object-cover ${showVideo ? "" : "invisible"}`}
      />
      {!showVideo && (
        <div className="absolute inset-0 flex items-center justify-center bg-[color:var(--color-panel-2)]">
          <Avatar name={name} photoUrl={photoUrl} size={112} />
        </div>
      )}
      <div className="absolute bottom-2 left-2 flex items-center gap-2 rounded-lg bg-black/60 px-3 py-1 text-sm">
        <span>{label}</span>
        {micOff && <span title="Microfone desligado">🔇</span>}
      </div>
    </div>
  );
}

function ControlButton({
  active,
  danger,
  onClick,
  title,
  children,
}: {
  active: boolean;
  danger?: boolean;
  onClick: () => void;
  title: string;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`flex h-14 w-14 items-center justify-center rounded-full text-2xl transition ${
        danger
          ? "bg-[color:var(--color-danger)] text-white hover:brightness-110"
          : active
            ? "bg-[color:var(--color-panel-2)] hover:bg-[color:var(--color-line)]"
            : "bg-[color:var(--color-danger)]/80 text-white hover:brightness-110"
      }`}
    >
      {children}
    </button>
  );
}

export function CallScreen({
  call,
  localStream,
  localName,
  localPhotoUrl,
  guestLink,
}: {
  call: UseWebRTCCallResult;
  localStream: MediaStream;
  localName: string;
  localPhotoUrl: string | null;
  guestLink: string | null;
}) {
  const [sasDismissed, setSasDismissed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [devices, setDevices] = useState<{ cams: MediaDeviceOption[]; mics: MediaDeviceOption[] }>(
    { cams: [], mics: [] },
  );
  const waiting = call.state === "waiting" || call.state === "connecting";

  // Painel de dispositivos: enumera ao abrir e acompanha plugar/desplugar.
  useEffect(() => {
    if (!showSettings) return;
    let live = true;
    const refresh = () => {
      void listDevices().then((d) => {
        if (live) setDevices(d);
      });
    };
    refresh();
    navigator.mediaDevices.addEventListener("devicechange", refresh);
    return () => {
      live = false;
      navigator.mediaDevices.removeEventListener("devicechange", refresh);
    };
  }, [showSettings]);

  const currentMicId = localStream.getAudioTracks()[0]?.getSettings().deviceId ?? "";
  const currentCamId = localStream.getVideoTracks()[0]?.getSettings().deviceId ?? "";

  const remoteShowsVideo =
    call.state === "connected" &&
    call.remoteStream !== null &&
    call.remoteMedia.camOn &&
    !call.remoteMedia.fallback;

  const localShowsVideo = call.camOn && !call.localFallback;

  return (
    <div className="flex h-dvh flex-col gap-3 p-3">
      {/* Faixa de avisos: SAS + qualidade + reconexão */}
      {call.state === "connected" && call.sas && !sasDismissed && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[color:var(--color-brand)] bg-[color:var(--color-brand-soft)]/40 px-4 py-3 text-sm">
          <p>
            🔒 Código de segurança: <strong className="text-lg tracking-widest">{call.sas}</strong>
            {" — "}leiam este código em voz alta um para o outro. Se for igual nos dois lados,
            a conversa está protegida.
          </p>
          <button
            type="button"
            onClick={() => setSasDismissed(true)}
            className="rounded-lg border border-[color:var(--color-line)] px-3 py-1 transition hover:bg-[color:var(--color-panel-2)]"
          >
            Conferimos ✓
          </button>
        </div>
      )}
      {call.state === "reconnecting" && (
        <div className="rounded-xl border border-[color:var(--color-warn)] bg-yellow-950/40 px-4 py-3 text-sm text-[color:var(--color-warn)]">
          Conexão instável — tentando reconectar…
        </div>
      )}
      {(call.localFallback || call.remoteMedia.fallback) && call.state === "connected" && (
        <div className="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-panel)] px-4 py-2 text-sm text-[color:var(--color-ink-dim)]">
          A internet oscilou: o vídeo virou foto por um instante para a voz continuar limpa.
          Ele volta sozinho quando a conexão melhorar.
        </div>
      )}

      {/* Grid de mídia */}
      <div className="relative min-h-0 flex-1">
        {waiting ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-[color:var(--color-line)] bg-[color:var(--color-panel)] p-6 text-center">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-[color:var(--color-line)] border-t-[color:var(--color-brand)]" />
            <p className="text-lg">
              {call.state === "waiting"
                ? "Aguardando o outro participante…"
                : "Conectando vocês dois…"}
            </p>
            {guestLink && call.state === "waiting" && (
              <div className="flex w-full max-w-md items-center gap-2">
                <input
                  readOnly
                  value={guestLink}
                  className="min-w-0 flex-1 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-panel-2)] px-3 py-2 text-sm text-[color:var(--color-ink-dim)]"
                />
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(guestLink).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    });
                  }}
                  className="rounded-lg bg-[color:var(--color-brand)] px-4 py-2 text-sm font-semibold text-white"
                >
                  {copied ? "Copiado!" : "Copiar convite"}
                </button>
              </div>
            )}
          </div>
        ) : (
          <MediaTile
            stream={call.remoteStream}
            showVideo={remoteShowsVideo}
            name={call.remoteProfile.name}
            photoUrl={call.remoteProfile.photoUrl}
            mirrored={false}
            muted={!call.speakerOn}
            micOff={!call.remoteMedia.micOn}
            label={call.remoteProfile.name}
          />
        )}

        {/* Miniatura local (sempre muted: nunca ouvir a si mesmo) */}
        <div className="absolute bottom-3 right-3 h-28 w-40 shadow-lg sm:h-36 sm:w-52">
          <MediaTile
            stream={localStream}
            showVideo={localShowsVideo}
            name={localName}
            photoUrl={localPhotoUrl}
            mirrored
            muted
            micOff={!call.micOn}
            label="Você"
            refreshKey={call.streamEpoch}
          />
        </div>
      </div>

      {/* Painel de dispositivos (⚙️) — troca a quente, sem derrubar a chamada */}
      {showSettings && (
        <div className="mx-auto w-full max-w-sm space-y-3 rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-panel)] p-4">
          <div className="flex items-center justify-between">
            <p className="font-semibold">Dispositivos</p>
            <button
              type="button"
              onClick={() => setShowSettings(false)}
              aria-label="Fechar dispositivos"
              className="rounded-lg border border-[color:var(--color-line)] px-2 py-1 text-sm transition hover:bg-[color:var(--color-panel-2)]"
            >
              ✕
            </button>
          </div>
          <DevicePicker
            cams={devices.cams}
            mics={devices.mics}
            camId={currentCamId}
            micId={currentMicId}
            showCamera
            onCam={(id) => void call.switchCam(id)}
            onMic={(id) => void call.switchMic(id)}
          />
          <p className="text-xs text-[color:var(--color-ink-dim)]">
            A troca acontece na hora, sem interromper a conversa.
          </p>
        </div>
      )}

      {/* Barra de controles */}
      <div className="flex items-center justify-center gap-3 pb-1">
        <ControlButton
          active={call.micOn}
          onClick={call.toggleMic}
          title={call.micOn ? "Desligar meu microfone" : "Ligar meu microfone"}
        >
          {call.micOn ? "🎙️" : "🔇"}
        </ControlButton>
        <ControlButton
          active={call.camOn}
          onClick={() => void call.toggleCam()}
          title={call.camOn ? "Desligar minha câmera" : "Ligar minha câmera"}
        >
          {call.camOn ? "📹" : "🚫"}
        </ControlButton>
        <ControlButton
          active={call.speakerOn}
          onClick={call.toggleSpeaker}
          title={call.speakerOn ? "Silenciar o som que recebo" : "Voltar a ouvir"}
        >
          {call.speakerOn ? "🔊" : "🔈"}
        </ControlButton>
        <ControlButton
          active
          onClick={() => setShowSettings((s) => !s)}
          title="Escolher câmera e microfone"
        >
          ⚙️
        </ControlButton>
        <ControlButton
          active
          danger
          onClick={() => void call.hangUp()}
          title="Encerrar a conversa (o link deixa de funcionar)"
        >
          📞
        </ControlButton>
      </div>
    </div>
  );
}
