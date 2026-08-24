"use client";

// Página da sala: pré-chamada → chamada → encerramento. O token do anfitrião
// viaja no FRAGMENTO da URL (#k=...) — o fragmento nunca é enviado ao servidor,
// então não aparece em logs de acesso.
import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PreCall, type PreCallResult } from "@/components/PreCall";
import { CallScreen } from "@/components/CallScreen";
import { useWebRTCCall } from "@/lib/client/useWebRTCCall";

interface RoomInfo {
  requiresPassword: boolean;
  seatTaken: boolean;
}

interface JoinedSession {
  role: "host" | "guest";
  token: string;
  profile: PreCallResult;
  iceServers: RTCIceServer[];
}

type PageState =
  | { phase: "loading" }
  | { phase: "gone" }
  | { phase: "precall"; info: RoomInfo; relayAvailable: boolean; error: string | null }
  | { phase: "call"; session: JoinedSession };

function EndCard({ title, body }: { title: string; body: string }) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-md space-y-4 rounded-2xl border border-[color:var(--color-line)] bg-[color:var(--color-panel)] p-8 text-center">
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="text-[color:var(--color-ink-dim)]">{body}</p>
        <Link
          href="/"
          className="inline-block rounded-lg bg-[color:var(--color-brand)] px-5 py-2 font-semibold text-white"
        >
          Voltar ao início
        </Link>
      </div>
    </main>
  );
}

function ActiveCall({ roomId, session }: { roomId: string; session: JoinedSession }) {
  const { profile } = session;
  const call = useWebRTCCall({
    roomId,
    token: session.token,
    role: session.role,
    localName: profile.name,
    localPhoto: profile.photo,
    localStream: profile.stream,
    startWithVideo: profile.withVideo,
    iceServers: session.iceServers,
    relayOnly: profile.relayOnly,
  });

  const localPhotoUrl = useMemo(
    () => (profile.photo ? URL.createObjectURL(profile.photo) : null),
    [profile.photo],
  );
  useEffect(() => {
    return () => {
      if (localPhotoUrl) URL.revokeObjectURL(localPhotoUrl);
    };
  }, [localPhotoUrl]);

  const guestLink =
    session.role === "host" && typeof window !== "undefined"
      ? `${window.location.origin}/sala/${roomId}`
      : null;

  if (call.state === "ended") {
    return (
      <EndCard
        title="Conversa encerrada"
        body="O link desta sala deixou de funcionar. Até a próxima!"
      />
    );
  }
  if (call.state === "timeout") {
    return (
      <EndCard
        title="Ninguém se conectou"
        body="A sala ficou muito tempo esperando e foi fechada. Peça um convite novo para conversar."
      />
    );
  }
  if (call.state === "expired") {
    return (
      <EndCard
        title="Este link não vale mais"
        body="A sala expirou ou foi encerrada. Peça um convite novo para conversar."
      />
    );
  }
  if (call.state === "p2p-failed") {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <div className="w-full max-w-md space-y-4 rounded-2xl border border-[color:var(--color-line)] bg-[color:var(--color-panel)] p-8 text-center">
          <h1 className="text-2xl font-bold">Não conseguimos conectar vocês</h1>
          <p className="text-[color:var(--color-ink-dim)]">
            A internet de um dos dois está bloqueando a conexão direta — isso é comum em
            internet de celular (4G/5G), VPNs e redes de empresa. Não é culpa sua, nem do
            seu aparelho.
          </p>
          <p className="text-sm text-[color:var(--color-ink-dim)]">
            Vale tentar: desligar VPN, trocar o celular para o wi-fi (ou vice-versa) e
            tentar de novo. Se acontecer sempre, o administrador do serviço precisa ativar
            o modo de retransmissão.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-block rounded-lg bg-[color:var(--color-brand)] px-5 py-2 font-semibold text-white"
          >
            Tentar de novo
          </button>
        </div>
      </main>
    );
  }

  return (
    <CallScreen
      call={call}
      localStream={profile.stream}
      localName={profile.name}
      localPhotoUrl={localPhotoUrl}
      guestLink={guestLink}
    />
  );
}

export default function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [state, setState] = useState<PageState>({ phase: "loading" });
  const [hostToken, setHostToken] = useState<string | null>(null);

  useEffect(() => {
    // Token do anfitrião no fragmento (#k=...).
    const match = window.location.hash.match(/k=([0-9a-f]{64})/);
    if (match?.[1]) setHostToken(match[1]);

    Promise.all([
      fetch(`/api/rooms/${id}`, { cache: "no-store" }),
      fetch("/api/ice", { cache: "no-store" }),
    ])
      .then(async ([roomRes, iceRes]) => {
        if (!roomRes.ok) {
          setState({ phase: "gone" });
          return;
        }
        const info = (await roomRes.json()) as RoomInfo;
        const ice = (await iceRes.json().catch(() => null)) as { relayAvailable?: boolean } | null;
        setState({
          phase: "precall",
          info,
          relayAvailable: Boolean(ice?.relayAvailable),
          error: null,
        });
      })
      .catch(() => setState({ phase: "gone" }));
  }, [id]);

  const handleJoin = useCallback(
    async (result: PreCallResult) => {
      const iceRes = await fetch("/api/ice", { cache: "no-store" });
      const iceData = (await iceRes.json()) as { iceServers: RTCIceServer[] };

      if (hostToken) {
        setState({
          phase: "call",
          session: { role: "host", token: hostToken, profile: result, iceServers: iceData.iceServers },
        });
        return;
      }

      // Reentrada do convidado (ex.: recarregou após falha de conexão): a vaga
      // já é dele — reusa o token salvo em vez de disputar a vaga de novo.
      try {
        const saved = sessionStorage.getItem(`meet-guest-${id}`);
        if (saved) {
          const probe = await fetch(
            `/api/rooms/${id}/signal?token=${saved}&after=0`,
            { cache: "no-store" },
          );
          if (probe.ok) {
            setState({
              phase: "call",
              session: {
                role: "guest",
                token: saved,
                profile: result,
                iceServers: iceData.iceServers,
              },
            });
            return;
          }
          sessionStorage.removeItem(`meet-guest-${id}`);
        }
      } catch {
        // sem storage — segue o fluxo normal
      }

      const res = await fetch(`/api/rooms/${id}/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(result.password ? { password: result.password } : {}),
      });
      const data = (await res.json().catch(() => null)) as
        | { guestToken?: string; error?: string }
        | null;
      if (!res.ok || !data?.guestToken) {
        setState((prev) =>
          prev.phase === "precall"
            ? { ...prev, error: data?.error ?? "Não foi possível entrar. Tente de novo." }
            : prev,
        );
        return;
      }
      try {
        sessionStorage.setItem(`meet-guest-${id}`, data.guestToken);
      } catch {
        // sem storage — reentrada não estará disponível
      }
      setState({
        phase: "call",
        session: {
          role: "guest",
          token: data.guestToken,
          profile: result,
          iceServers: iceData.iceServers,
        },
      });
    },
    [hostToken, id],
  );

  if (state.phase === "loading") {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-[color:var(--color-line)] border-t-[color:var(--color-brand)]" />
      </main>
    );
  }
  if (state.phase === "gone") {
    return (
      <EndCard
        title="Este link não vale mais"
        body="A sala não existe, expirou ou já foi encerrada. Peça um convite novo para conversar."
      />
    );
  }
  if (state.phase === "precall") {
    // Anfitrião entra sem senha (o token dele já autoriza); convidado segue as regras.
    return (
      <main className="flex min-h-dvh items-center justify-center p-4">
        <PreCall
          requiresPassword={state.info.requiresPassword && !hostToken}
          relayAvailable={state.relayAvailable}
          errorMessage={state.error}
          onJoin={(r) => void handleJoin(r)}
        />
      </main>
    );
  }
  return <ActiveCall roomId={id} session={state.session} />;
}
