"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Entrada por código de sala (o link completo também funciona colado aqui). */
export function JoinByCode() {
  const router = useRouter();
  const [value, setValue] = useState("");

  function join() {
    const raw = value.trim();
    if (!raw) return;
    // Aceita tanto o código puro quanto o link completo colado.
    const match = raw.match(/sala\/([a-z2-9]+)/i);
    const code = match?.[1] ?? raw;
    router.push(`/sala/${encodeURIComponent(code.toLowerCase())}`);
  }

  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        join();
      }}
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Código da sala ou link"
        aria-label="Código da sala"
        className="min-w-0 flex-1 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-panel)] px-4 py-3 text-[color:var(--color-ink)] outline-none transition placeholder:text-[color:var(--color-ink-dim)] focus:border-[color:var(--color-brand)]"
      />
      <button
        type="submit"
        className="rounded-lg bg-[color:var(--color-brand)] px-5 py-3 font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
        disabled={!value.trim()}
      >
        Entrar
      </button>
    </form>
  );
}
