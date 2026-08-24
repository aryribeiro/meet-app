import { db, touchRoom } from "@/lib/server/db";
import { authRoom, badRequest, json, prepare, readBody, unauthorized } from "@/lib/server/http";

export const runtime = "nodejs";

/** Teto de tamanho de uma mensagem de sinalização (SDP grande ~ dezenas de KB). */
const MAX_PAYLOAD_BYTES = 64 * 1024;

/**
 * POST: deposita uma mensagem (offer/answer/ICE) na caixa de correio da sala.
 * Exige token de sala — sem ele ninguém escreve sinalização, nem com o link.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  await prepare();
  const { id } = await ctx.params;
  const body = await readBody(req);
  const auth = await authRoom(id, body["token"]);
  if (!auth) return unauthorized();

  const payload = body["payload"];
  if (typeof payload !== "string" || payload.length === 0) {
    return badRequest("Payload ausente.");
  }
  if (payload.length > MAX_PAYLOAD_BYTES) return badRequest("Payload grande demais.");

  await db().execute({
    sql: `INSERT INTO signals (room_id, sender, payload, created_at) VALUES (?, ?, ?, ?)`,
    args: [id, auth.role, payload, Date.now()],
  });
  await touchRoom(id);
  return json({ ok: true });
}

/**
 * GET: polling. Retorna mensagens do OUTRO peer com seq > after e apaga as que o
 * chamador já confirmou (seq <= after) — retenção zero com entrega at-least-once:
 * uma resposta perdida na rede é reentregue no próximo poll, porque só apagamos
 * após o ack implícito do cursor `after`.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  await prepare();
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const afterRaw = url.searchParams.get("after");
  const after = afterRaw ? Number.parseInt(afterRaw, 10) : 0;
  if (!Number.isFinite(after) || after < 0) return badRequest("Cursor inválido.");

  const auth = await authRoom(id, token);
  if (!auth) return unauthorized();
  const other = auth.role === "host" ? "guest" : "host";

  const c = db();
  // Ack: apaga o que o chamador já leu (linhas do outro peer até o cursor).
  await c.execute({
    sql: `DELETE FROM signals WHERE room_id = ? AND sender = ? AND seq <= ?`,
    args: [id, other, after],
  });
  const res = await c.execute({
    sql: `SELECT seq, payload FROM signals
          WHERE room_id = ? AND sender = ? AND seq > ?
          ORDER BY seq ASC LIMIT 50`,
    args: [id, other, after],
  });
  await touchRoom(id);

  // peerJoined: o anfitrião usa isso para sair do estado "aguardando participante".
  const roomRes = await c.execute({
    sql: `SELECT guest_token FROM rooms WHERE id = ?`,
    args: [id],
  });
  const peerJoined = roomRes.rows[0] ? roomRes.rows[0]["guest_token"] !== null : false;

  return json({
    messages: res.rows.map((r) => ({ seq: Number(r["seq"]), payload: String(r["payload"]) })),
    peerJoined,
  });
}
