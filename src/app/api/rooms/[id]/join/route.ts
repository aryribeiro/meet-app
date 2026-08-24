import { db, touchRoom } from "@/lib/server/db";
import { randomToken, verifyPassword } from "@/lib/server/auth";
import { badRequest, json, notFound, prepare, readBody, unauthorized } from "@/lib/server/http";

export const runtime = "nodejs";

/**
 * Entrada do convidado. Duas garantias do contrato:
 * 1. Senha (se definida) validada contra hash PBKDF2 ANTES de emitir token — a senha
 *    protege a sinalização, não só a UI.
 * 2. Vaga única ocupada por UPDATE atômico (WHERE guest_token IS NULL) conferindo
 *    linhas afetadas — nunca ler-checar-escrever, para não haver race com polling.
 *    A 3ª tentativa de conexão encontra guest_token preenchido e é rejeitada.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  await prepare();
  const { id } = await ctx.params;
  const body = await readBody(req);

  const res = await db().execute({
    sql: `SELECT password_hash, password_salt, status, expires_at FROM rooms WHERE id = ?`,
    args: [id],
  });
  const row = res.rows[0];
  if (!row || String(row["status"]) !== "open" || Number(row["expires_at"]) < Date.now()) {
    return notFound();
  }

  if (row["password_hash"] !== null) {
    const password = body["password"];
    if (typeof password !== "string" || password.length === 0) {
      return badRequest("Esta sala pede senha.");
    }
    const ok = await verifyPassword(password, {
      hash: String(row["password_hash"]),
      salt: String(row["password_salt"]),
    });
    if (!ok) return unauthorized("Senha incorreta.");
  }

  const guestToken = randomToken();
  const claim = await db().execute({
    sql: `UPDATE rooms SET guest_token = ?
          WHERE id = ? AND guest_token IS NULL AND status = 'open'`,
    args: [guestToken, id],
  });
  if (claim.rowsAffected === 0) {
    return json({ error: "A sala já está cheia (limite de 2 pessoas)." }, 409);
  }

  await touchRoom(id);
  return json({ guestToken });
}
