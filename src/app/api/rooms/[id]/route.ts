import { db } from "@/lib/server/db";
import { json, notFound, prepare } from "@/lib/server/http";

export const runtime = "nodejs";

/**
 * Informação pública mínima da sala (para a tela de pré-chamada do convidado):
 * existe? pede senha? ainda tem vaga? Nada além disso vaza sem token.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  await prepare();
  const { id } = await ctx.params;
  const res = await db().execute({
    sql: `SELECT password_hash, guest_token, status, expires_at FROM rooms WHERE id = ?`,
    args: [id],
  });
  const row = res.rows[0];
  if (!row || String(row["status"]) !== "open" || Number(row["expires_at"]) < Date.now()) {
    return notFound();
  }
  return json({
    exists: true,
    requiresPassword: row["password_hash"] !== null,
    seatTaken: row["guest_token"] !== null,
  });
}
