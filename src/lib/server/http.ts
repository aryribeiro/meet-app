import { NextResponse } from "next/server";
import { db, ensureSchema, lazyCleanup } from "./db";

export function json(data: unknown, status = 200): NextResponse {
  // Respostas de API nunca são cacheáveis: sinalização é efêmera por definição.
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function badRequest(error: string): NextResponse {
  return json({ error }, 400);
}

export function unauthorized(error = "Não autorizado."): NextResponse {
  return json({ error }, 401);
}

export function notFound(error = "Sala não encontrada ou expirada."): NextResponse {
  return json({ error }, 404);
}

/** Prólogo de toda rota: schema garantido + limpeza lazy (retenção zero). */
export async function prepare(): Promise<void> {
  await ensureSchema();
  await lazyCleanup();
}

/**
 * Prólogo das rotas de POLLING (chamadas a cada ~1 s): a limpeza lazy roda por
 * amostragem (~20%) — continua acontecendo em segundos, mas corta a maioria das
 * viagens extras ao Turso no caminho mais quente do app. A correção não depende
 * dela: authRoom confere expiração na própria leitura.
 */
export async function prepareLight(): Promise<void> {
  await ensureSchema();
  if (Math.random() < 0.2) await lazyCleanup();
}

/** Lê o corpo JSON com tolerância a corpo vazio/inválido. */
export async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const data: unknown = await req.json();
    if (data && typeof data === "object") return data as Record<string, unknown>;
    return {};
  } catch {
    return {};
  }
}

export interface OperatorGate {
  ok: boolean;
}

/** Valida sessão do operador (token emitido no login do painel). */
export async function checkOperatorSession(token: unknown): Promise<boolean> {
  if (typeof token !== "string" || token.length < 32) return false;
  const res = await db().execute({
    sql: "SELECT token FROM operator_sessions WHERE token = ? AND expires_at > ?",
    args: [token, Date.now()],
  });
  return res.rows.length > 0;
}

export type RoomRole = "host" | "guest";

export interface RoomAuth {
  role: RoomRole;
  status: string;
}

/**
 * Identifica o papel de quem chama uma rota de sala pelo token de sala.
 * O token protege a SINALIZAÇÃO em si (não só a UI): sem ele, nem o operador
 * de rede nem um terceiro com o link conseguem ler/escrever SDP da sala.
 */
export async function authRoom(
  roomIdParam: string,
  token: unknown,
): Promise<RoomAuth | null> {
  if (typeof token !== "string" || token.length < 32) return null;
  const res = await db().execute({
    sql: `SELECT host_token, guest_token, status, expires_at FROM rooms WHERE id = ?`,
    args: [roomIdParam],
  });
  const row = res.rows[0];
  if (!row) return null;
  const expires = Number(row["expires_at"]);
  const status = String(row["status"]);
  if (status !== "open" || expires < Date.now()) return null;
  if (row["host_token"] === token) return { role: "host", status };
  if (row["guest_token"] === token) return { role: "guest", status };
  return null;
}
