"use client";

// Webchat entre os dois participantes — painel abaixo do palco, altura FIXA
// com rolagem interna (o palco aprovado nunca muda de tamanho). Texto puro:
// React escapa tudo, sem HTML, sem auto-link; URLs ficam como texto e cada
// mensagem tem "copiar". Arquivos: só download, nunca abertos inline; nome e
// tipo já chegam validados pelo hook. Nada é persistido — a lista morre com a aba.
import { useEffect, useRef, useState } from "react";
import { formatBytes, type ChatMessage } from "@/lib/shared/chat";
import { CHAT_MAX_CHARS, FILE_MAX_BYTES } from "@/lib/shared/constants";

function timeLabel(ms: number): string {
  try {
    return new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function FileBody({ msg }: { msg: ChatMessage }) {
  const f = msg.file;
  if (!f) return null;
  const pct = f.size > 0 ? Math.min(100, Math.round((f.bytes / f.size) * 100)) : 0;
  const statusText =
    f.status === "sending"
      ? `enviando… ${pct}%`
      : f.status === "receiving"
        ? `recebendo… ${pct}%`
        : f.status === "failed"
          ? "falhou"
          : msg.from === "me"
            ? "enviado"
            : "recebido";
  return (
    <div className="flex min-w-48 flex-col gap-1" data-chat-file-status={f.status}>
      <p className="flex items-center gap-2 break-all font-medium">
        <span aria-hidden>📎</span>
        <span data-chat-text>{msg.text}</span>
      </p>
      <p className="text-xs text-[color:var(--color-ink-dim)]">
        {formatBytes(f.size)} · {statusText}
      </p>
      {(f.status === "sending" || f.status === "receiving") && (
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-black/30"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-full bg-[color:var(--color-brand)] transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      )}
      {f.status === "done" && f.url && msg.from === "peer" && (
        <a
          href={f.url}
          download={msg.text}
          className="mt-1 w-fit rounded-lg bg-[color:var(--color-brand)] px-3 py-1 text-xs font-semibold text-white hover:brightness-110"
        >
          Baixar
        </a>
      )}
    </div>
  );
}

function Message({ msg, peerName }: { msg: ChatMessage; peerName: string }) {
  const [copied, setCopied] = useState(false);
  const mine = msg.from === "me";
  return (
    <li
      data-chat-msg={msg.from}
      className={`group flex max-w-[85%] flex-col gap-0.5 ${mine ? "self-end items-end" : "self-start items-start"}`}
    >
      <div
        className={`rounded-2xl px-3 py-2 text-sm leading-snug ${
          mine
            ? "rounded-br-sm bg-[color:var(--color-brand-soft)] text-[color:var(--color-ink)]"
            : "rounded-bl-sm bg-[color:var(--color-panel-2)] text-[color:var(--color-ink)]"
        }`}
      >
        {msg.file ? (
          <FileBody msg={msg} />
        ) : (
          /* pre-wrap: quebras de linha do autor valem; tudo é TEXTO (React escapa). */
          <p className="whitespace-pre-wrap break-words" data-chat-text>
            {msg.text}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 px-1 text-[11px] text-[color:var(--color-ink-dim)]">
        <span>
          {mine ? "Você" : peerName} · {timeLabel(msg.at)}
        </span>
        {mine && msg.delivered === false && (
          <span className="text-[color:var(--color-warn)]" title="O canal estava fechado nesse momento">
            não enviada
          </span>
        )}
        {!msg.file && (
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(msg.text).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
            className="opacity-0 transition hover:underline focus:opacity-100 group-hover:opacity-100"
            aria-label="Copiar mensagem"
          >
            {copied ? "copiado" : "copiar"}
          </button>
        )}
      </div>
    </li>
  );
}

export function ChatPanel({
  messages,
  peerName,
  canSend,
  viaRelay,
  onSend,
  onSendFile,
  onClose,
}: {
  messages: ChatMessage[];
  peerName: string;
  /** Canal direto aberto? (fora disso o campo avisa em vez de fingir) */
  canSend: boolean;
  /** A chamada está passando por retransmissão (arquivo pesa na cota). */
  viaRelay: boolean;
  onSend: (text: string) => boolean;
  onSendFile: (file: File) => Promise<{ ok: boolean; reason?: string }>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const stickToBottomRef = useRef(true);

  // Auto-scroll só se o leitor já estava no fim (não puxar quem está lendo acima).
  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  function submit() {
    if (!draft.trim()) return;
    if (onSend(draft)) {
      setDraft("");
      stickToBottomRef.current = true;
    }
  }

  async function pickFile(list: FileList | null) {
    const file = list?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    stickToBottomRef.current = true;
    const r = await onSendFile(file);
    if (!r.ok && r.reason) setNotice(r.reason);
  }

  const remaining = CHAT_MAX_CHARS - Array.from(draft).length;
  const maxMb = Math.round(FILE_MAX_BYTES / 1024 / 1024);

  return (
    <section
      data-chat-panel
      aria-label="Conversa por texto"
      className="mx-auto flex h-64 w-full max-w-[1280px] flex-col rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-panel)]"
    >
      <header className="flex items-center justify-between border-b border-[color:var(--color-line)] px-4 py-2 text-sm">
        <p className="font-semibold">💬 Mensagens</p>
        <div className="flex items-center gap-3 text-xs text-[color:var(--color-ink-dim)]">
          <span className="hidden sm:inline">Só vocês dois veem. Nada fica guardado.</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Esconder mensagens"
            className="rounded-lg border border-[color:var(--color-line)] px-2 py-1 transition hover:bg-[color:var(--color-panel-2)]"
          >
            ✕
          </button>
        </div>
      </header>

      <ul
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-3"
      >
        {messages.length === 0 && (
          <li className="m-auto text-center text-sm text-[color:var(--color-ink-dim)]">
            Mande um link, um número, um &quot;não te ouço&quot; ou um arquivo — sem interromper a conversa.
          </li>
        )}
        {messages.map((m) => (
          <Message key={m.id} msg={m} peerName={peerName} />
        ))}
      </ul>

      {notice && (
        <p
          data-chat-notice
          className="border-t border-[color:var(--color-line)] px-4 py-1.5 text-xs text-[color:var(--color-warn)]"
        >
          {notice}
        </p>
      )}

      <form
        className="flex items-end gap-2 border-t border-[color:var(--color-line)] px-3 py-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          ref={fileRef}
          type="file"
          data-chat-file
          className="sr-only"
          aria-label="Escolher arquivo para enviar"
          onChange={(e) => void pickFile(e.target.files)}
          disabled={!canSend}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={!canSend}
          title={
            viaRelay
              ? `Enviar arquivo (até ${maxMb} MB). Esta conversa passa por retransmissão: arquivos grandes pesam na cota.`
              : `Enviar arquivo (até ${maxMb} MB)`
          }
          aria-label="Enviar arquivo"
          className="h-10 w-10 shrink-0 rounded-lg border border-[color:var(--color-line)] text-lg transition hover:bg-[color:var(--color-panel-2)] disabled:opacity-50"
        >
          📎
        </button>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          maxLength={CHAT_MAX_CHARS * 2}
          placeholder={canSend ? "Escreva uma mensagem (Enter envia)" : "Aguardando a conexão…"}
          aria-label="Mensagem"
          className="max-h-24 min-h-10 min-w-0 flex-1 resize-none rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-panel-2)] px-3 py-2 text-sm text-[color:var(--color-ink)] outline-none transition placeholder:text-[color:var(--color-ink-dim)] focus:border-[color:var(--color-brand)]"
        />
        <div className="flex flex-col items-end gap-1">
          {remaining < 200 && (
            <span
              className={`text-[11px] ${remaining < 0 ? "text-[color:var(--color-danger)]" : "text-[color:var(--color-ink-dim)]"}`}
            >
              {remaining < 0 ? `${-remaining} a mais` : `${remaining} restantes`}
            </span>
          )}
          <button
            type="submit"
            disabled={!draft.trim()}
            className="rounded-lg bg-[color:var(--color-brand)] px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
          >
            Enviar
          </button>
        </div>
      </form>
    </section>
  );
}
