// Webchat — modelo e validação PUROS (sem browser): testáveis em Node.
// Regras do conselho (12/09/2026): texto puro, sem HTML, sem auto-link; o que
// vem do outro participante é validado em forma, tamanho e caracteres de
// controle antes de entrar na tela; nada é persistido.
import { CHAT_MAX_CHARS, FILE_ALLOWED_EXT, FILE_MAX_BYTES, FILE_NAME_MAX } from "./constants";

/** O que trafega no DataChannel como type "chat". */
export interface ChatPayload {
  /** Id do remetente para dedupe/ordem local (aleatório, sem significado). */
  id: string;
  text: string;
  /** Hora de envio no relógio do remetente (ms); só informativa. */
  at: number;
}

export type FileStatus = "sending" | "receiving" | "done" | "failed";

export interface ChatMessage extends ChatPayload {
  from: "me" | "peer";
  /** Só para as minhas: o canal estava aberto na hora do envio? */
  delivered?: boolean;
  /** Mensagem de arquivo (text = nome sanitizado). */
  file?: {
    size: number;
    /** bytes transferidos até agora (honesto: vem do canal, não de animação). */
    bytes: number;
    status: FileStatus;
    /** URL de objeto para baixar — só no receptor, só quando status = done. */
    url?: string;
  };
}

/**
 * Nome de arquivo vindo de fora: sem caminho, sem controle/invisíveis, sem
 * caracteres proibidos no Windows, ≤ FILE_NAME_MAX, extensão preservada.
 * `../..\\x<script>.png` → `x_script_.png`.
 */
export function sanitizeFileName(raw: string): string {
  const base = raw.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "";
  let out = "";
  for (const ch of base) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) || cp === 0x200b || cp === 0xfeff) continue;
    if ((cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069)) continue;
    out += '<>:"|?*'.includes(ch) ? "_" : ch;
  }
  out = out.trim().replace(/^\.+/, "");
  if (!out) return "arquivo";
  const chars = Array.from(out);
  if (chars.length > FILE_NAME_MAX) {
    const dot = out.lastIndexOf(".");
    const ext = dot > 0 ? out.slice(dot) : "";
    out = Array.from(out.slice(0, dot > 0 ? dot : out.length))
      .slice(0, Math.max(1, FILE_NAME_MAX - Array.from(ext).length))
      .join("") + ext;
  }
  return out;
}

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : "";
}

/** Decide se um arquivo pode entrar — mesma função no envio e no recebimento. */
export function checkFile(name: string, size: number): { ok: true; name: string } | { ok: false; reason: string } {
  const clean = sanitizeFileName(name);
  const ext = fileExtension(clean);
  if (!ext || !FILE_ALLOWED_EXT.includes(ext)) {
    return { ok: false, reason: "Esse tipo de arquivo não é aceito. Vale: imagens, PDF, documentos, áudio, vídeo e compactados." };
  }
  if (!Number.isFinite(size) || size <= 0) return { ok: false, reason: "Arquivo vazio." };
  if (size > FILE_MAX_BYTES) {
    return { ok: false, reason: `Acima do limite de ${Math.round(FILE_MAX_BYTES / 1024 / 1024)} MB.` };
  }
  return { ok: true, name: clean };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
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
