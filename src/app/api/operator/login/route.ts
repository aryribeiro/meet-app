import { db } from "@/lib/server/db";
import { verifyPassword, randomToken } from "@/lib/server/auth";
import { badRequest, json, prepare, readBody, unauthorized } from "@/lib/server/http";
import { OPERATOR_SESSION_MS } from "@/lib/shared/constants";

export const runtime = "nodejs";

/**
 * Login do operador (dono do serviço). A verificação SEMPRE compara contra o hash
 * PBKDF2 no Turso — nunca contra constante em código (PROMPT.md, emenda 1).
 */
export async function POST(req: Request): Promise<Response> {
  await prepare();
  const body = await readBody(req);
  const password = body["password"];
  if (typeof password !== "string" || password.length === 0) {
    return badRequest("Informe a senha.");
  }

  const res = await db().execute("SELECT password_hash, salt FROM operator WHERE id = 1");
  const row = res.rows[0];
  if (!row) return unauthorized("Operador não configurado.");

  const ok = await verifyPassword(password, {
    hash: String(row["password_hash"]),
    salt: String(row["salt"]),
  });
  if (!ok) return unauthorized("Senha incorreta.");

  const token = randomToken();
  const now = Date.now();
  await db().execute({
    sql: "INSERT INTO operator_sessions (token, created_at, expires_at) VALUES (?, ?, ?)",
    args: [token, now, now + OPERATOR_SESSION_MS],
  });

  // mustChange: sinaliza ao painel que a senha ainda é a semente inicial.
  const stillSeed = await verifyPassword("admin123", {
    hash: String(row["password_hash"]),
    salt: String(row["salt"]),
  });

  return json({ token, mustChange: stillSeed });
}
