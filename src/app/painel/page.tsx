"use client";

// Painel do OPERADOR (dono do serviço): login, troca de senha obrigatória na
// primeira utilização e criação de reuniões. Sessão fica só em sessionStorage
// (morre com a aba — decisão de privacidade).
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Footer } from "@/components/Footer";

interface CreatedRoom {
  roomId: string;
  hostToken: string;
  requiresPassword: boolean;
}

const SESSION_KEY = "meet-operator-session";

export default function PanelPage() {
  const [session, setSession] = useState<string | null>(null);
  const [mustChange, setMustChange] = useState(false);
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [roomPassword, setRoomPassword] = useState("");
  const [created, setCreated] = useState<CreatedRoom | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copiedWhich, setCopiedWhich] = useState<"host" | "guest" | null>(null);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(SESSION_KEY);
      if (saved) setSession(saved);
    } catch {
      // storage bloqueado — segue deslogado
    }
  }, []);

  const login = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/operator/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = (await res.json().catch(() => null)) as
        | { token?: string; mustChange?: boolean; error?: string }
        | null;
      if (!res.ok || !data?.token) {
        setMessage(data?.error ?? "Falha no login.");
        return;
      }
      setSession(data.token);
      setMustChange(Boolean(data.mustChange));
      setPassword("");
      try {
        sessionStorage.setItem(SESSION_KEY, data.token);
      } catch {
        // sem storage — sessão vive só no estado
      }
    } finally {
      setBusy(false);
    }
  }, [password]);

  const changePassword = useCallback(async () => {
    if (!session) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/operator/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: session, newPassword }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setMessage(data?.error ?? "Não foi possível trocar a senha.");
        return;
      }
      setMustChange(false);
      setNewPassword("");
      setMessage("Senha atualizada com sucesso.");
    } finally {
      setBusy(false);
    }
  }, [session, newPassword]);

  const createRoom = useCallback(async () => {
    if (!session) return;
    setBusy(true);
    setMessage(null);
    setCreated(null);
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          roomPassword ? { token: session, roomPassword } : { token: session },
        ),
      });
      const data = (await res.json().catch(() => null)) as
        | (CreatedRoom & { error?: string })
        | null;
      if (!res.ok || !data?.roomId) {
        if (res.status === 401) {
          setSession(null);
          try {
            sessionStorage.removeItem(SESSION_KEY);
          } catch {
            // ignora
          }
          setMessage("Sessão expirou — entre de novo.");
          return;
        }
        setMessage(data?.error ?? "Não foi possível criar a reunião.");
        return;
      }
      setCreated(data);
      setRoomPassword("");
    } finally {
      setBusy(false);
    }
  }, [session, roomPassword]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  // Link do anfitrião: token no fragmento (#k=) — não vai para logs de servidor.
  const hostLink = created ? `${origin}/sala/${created.roomId}#k=${created.hostToken}` : "";
  const guestLink = created ? `${origin}/sala/${created.roomId}` : "";

  function copy(text: string, which: "host" | "guest") {
    void navigator.clipboard.writeText(text).then(() => {
      setCopiedWhich(which);
      setTimeout(() => setCopiedWhich(null), 2000);
    });
  }

  const inputClass =
    "w-full rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-panel-2)] px-4 py-3 outline-none transition focus:border-[color:var(--color-brand)]";
  const buttonClass =
    "rounded-lg bg-[color:var(--color-brand)] px-5 py-3 font-semibold text-white transition hover:brightness-110 disabled:opacity-40";

  return (
    <main className="flex min-h-dvh flex-col">
      <div className="mx-auto w-full max-w-lg flex-1 space-y-6 px-6 py-12">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Painel</h1>
          <Link href="/" className="text-sm text-[color:var(--color-ink-dim)] hover:underline">
            ← Início
          </Link>
        </div>

        {message && (
          <p className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-panel)] px-4 py-3 text-sm">
            {message}
          </p>
        )}

        {!session && (
          <form
            className="space-y-4 rounded-2xl border border-[color:var(--color-line)] bg-[color:var(--color-panel)] p-6"
            onSubmit={(e) => {
              e.preventDefault();
              void login();
            }}
          >
            <p className="text-sm text-[color:var(--color-ink-dim)]">
              Área restrita do administrador do serviço.
            </p>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Senha do administrador"
              className={inputClass}
              autoFocus
            />
            <button type="submit" disabled={busy || !password} className={`${buttonClass} w-full`}>
              {busy ? "Entrando…" : "Entrar"}
            </button>
          </form>
        )}

        {session && mustChange && (
          <form
            className="space-y-4 rounded-2xl border border-[color:var(--color-warn)] bg-[color:var(--color-panel)] p-6"
            onSubmit={(e) => {
              e.preventDefault();
              void changePassword();
            }}
          >
            <h2 className="text-xl font-semibold">Primeira utilização</h2>
            <p className="text-sm text-[color:var(--color-ink-dim)]">
              Por segurança, troque a senha inicial antes de criar reuniões.
            </p>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Nova senha (mín. 8 caracteres)"
              className={inputClass}
              autoFocus
            />
            <button
              type="submit"
              disabled={busy || newPassword.length < 8}
              className={`${buttonClass} w-full`}
            >
              Salvar nova senha
            </button>
          </form>
        )}

        {session && !mustChange && (
          <>
            <div className="space-y-4 rounded-2xl border border-[color:var(--color-line)] bg-[color:var(--color-panel)] p-6">
              <h2 className="text-xl font-semibold">Nova reunião</h2>
              <input
                type="text"
                value={roomPassword}
                onChange={(e) => setRoomPassword(e.target.value)}
                placeholder="Senha da sala (opcional, mín. 4)"
                className={inputClass}
              />
              <button
                type="button"
                onClick={() => void createRoom()}
                disabled={busy || (roomPassword.length > 0 && roomPassword.length < 4)}
                className={`${buttonClass} w-full`}
              >
                {busy ? "Criando…" : "Criar reunião"}
              </button>

              {created && (
                <div className="space-y-3 border-t border-[color:var(--color-line)] pt-4 text-sm">
                  <div className="space-y-1">
                    <p className="font-semibold">Seu link (entre por ele):</p>
                    <div className="flex gap-2">
                      <input readOnly value={hostLink} className={`${inputClass} text-xs`} />
                      <button
                        type="button"
                        onClick={() => copy(hostLink, "host")}
                        className="shrink-0 rounded-lg border border-[color:var(--color-line)] px-3 text-sm transition hover:bg-[color:var(--color-panel-2)]"
                      >
                        {copiedWhich === "host" ? "Copiado!" : "Copiar"}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="font-semibold">Link do convidado (envie a ele):</p>
                    <div className="flex gap-2">
                      <input readOnly value={guestLink} className={`${inputClass} text-xs`} />
                      <button
                        type="button"
                        onClick={() => copy(guestLink, "guest")}
                        className="shrink-0 rounded-lg border border-[color:var(--color-line)] px-3 text-sm transition hover:bg-[color:var(--color-panel-2)]"
                      >
                        {copiedWhich === "guest" ? "Copiado!" : "Copiar"}
                      </button>
                    </div>
                  </div>
                  {created.requiresPassword && (
                    <p className="text-[color:var(--color-ink-dim)]">
                      Lembre de avisar a senha da sala ao convidado — por outro canal.
                    </p>
                  )}
                  <p className="text-[color:var(--color-ink-dim)]">
                    O link vale para uma conversa: quando ela termina (ou se ninguém entrar),
                    ele deixa de funcionar.
                  </p>
                </div>
              )}
            </div>

            <details className="rounded-2xl border border-[color:var(--color-line)] bg-[color:var(--color-panel)] p-6">
              <summary className="cursor-pointer font-semibold">Trocar minha senha</summary>
              <div className="mt-4 space-y-3">
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Nova senha (mín. 8 caracteres)"
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() => void changePassword()}
                  disabled={busy || newPassword.length < 8}
                  className={buttonClass}
                >
                  Salvar
                </button>
              </div>
            </details>

            <button
              type="button"
              onClick={() => {
                setSession(null);
                setCreated(null);
                try {
                  sessionStorage.removeItem(SESSION_KEY);
                } catch {
                  // ignora
                }
              }}
              className="text-sm text-[color:var(--color-ink-dim)] hover:underline"
            >
              Sair do painel
            </button>
          </>
        )}
      </div>
      <Footer />
    </main>
  );
}
