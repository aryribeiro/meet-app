// Webchat — modelo e validação PUROS (sem browser): testáveis em Node.
// Regras do conselho (12/09/2026): texto puro, sem HTML, sem auto-link; o que
// vem do outro participante é validado em forma, tamanho e caracteres de
// controle antes de entrar na tela; nada é persistido.
import { CHAT_MAX_CHARS } from "./constants";

/** O que trafega no DataChannel como type "chat". */
export interface ChatPayload {
  /** Id do remetente para dedupe/ordem local (aleatório, sem significado). */
  id: string;
  text: string;
  /** Hora de envio no relógio do remetente (ms); só informativa. */
  at: number;
}

export interface ChatMessage extends ChatPayload {
  from: "me" | "peer";
  /** Só para as minhas: o canal estava aberto na hora do envio? */
  delivered?: boolean;
}

/**
 * Remove caracteres de controle (mantém \n e \t), normaliza quebras e corta no
 * teto. Filtra por code point — nunca por comparação literal de caractere
 * ([[feedback_no_literal_control_chars]]).
 */
export function sanitizeChatText(raw: string): string {
  let out = "";
  for (const ch of raw.replace(/\r\n?/g, "\n")) {
    const cp = ch.codePointAt(0) ?? 0;
    const control = (cp < 0x20 && cp !== 0x0a && cp !== 0x09) || (cp >= 0x7f && cp <= 0x9f);
    const bidiOrInvisible =
      cp === 0x200b ||
      cp === 0x200e ||
      cp === 0x200f ||
      (cp >= 0x202a && cp <= 0x202e) ||
      (cp >= 0x2066 && cp <= 0x2069) ||
      cp === 0xfeff;
    if (control || bidiOrInvisible) continue;
    out += ch;
  }
  return Array.from(out.trim()).slice(0, CHAT_MAX_CHARS).join("");
}

/** Valida um payload vindo do outro participante. null = descartar em silêncio. */
export function parseChatPayload(raw: unknown): ChatPayload | null {
  if (typeof raw !== "object" || raw === null) return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.text !== "string" || typeof p.id !== "string") return null;
  if (p.id.length === 0 || p.id.length > 32) return null;
  // Teto ANTES de sanitizar: não gastar CPU com um bloco gigante.
  if (p.text.length > CHAT_MAX_CHARS * 4) return null;
  const text = sanitizeChatText(p.text);
  if (!text) return null;
  const at = typeof p.at === "number" && Number.isFinite(p.at) ? p.at : Date.now();
  return { id: p.id, text, at };
}

export function newChatId(): string {
  return Math.random().toString(36).slice(2, 12);
}
