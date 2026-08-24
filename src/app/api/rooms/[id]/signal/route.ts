import { db } from "@/lib/server/db";
import {
  authRoom,
  badRequest,
  json,
  prepareLight,
  readBody,
  unauthorized,
} from "@/lib/server/http";
import { ROOM_INACTIVITY_MS } from "@/lib/shared/constants";

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
  await prepareLight();
  const { id } = await ctx.params;
  const body = await readBody(req);
  const auth = await authRoom(id, body["token"]);
  if (!auth) return unauthorized();

  const payload = body["payload"];
  if (typeof payload !== "string" || payload.length === 0) {
    return badRequest("Payload ausente.");
  }
  if (payload.length > MAX_PAYLOAD_BYTES) return badRequest("Payload grande demais.");

  // INSERT + renovação da expiração numa viagem só (batch).
  const now = Date.now();
  await db().batch(
    [
      {
        sql: `INSERT INTO signals (room_id, sender, payload, created_at) VALUES (?, ?, ?, ?)`,
        args: [id, auth.role, payload, now],
      },
      {
        sql: `UPDATE rooms SET last_activity = ?, expires_at = ? WHERE id = ? AND status = 'open'`,
        args: [now, now + ROOM_INACTIVITY_MS, id],
      },
    ],
    "write",
  );
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
  await prepareLight();
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const afterRaw = url.searchParams.get("after");
  const after = afterRaw ? Number.parseInt(afterRaw, 10) : 0;
  if (!Number.isFinite(after) || after < 0) return badRequest("Cursor inválido.");

  const auth = await authRoom(id, token);
  if (!auth) return unauthorized();
  const other = auth.role === "host" ? "guest" : "host";

  // Caminho mais quente do app (1 req/s por peer): ack + leitura + renovação de
  // expiração + peerJoined numa ÚNICA viagem ao Turso (batch), na ordem certa.
  const now = Date.now();
  const [, msgsRes, , roomRes] = await db().batch(
    [
      {
        sql: `DELETE FROM signals WHERE room_id = ? AND sender = ? AND seq <= ?`,
        args: [id, other, after],
      },
      {
        sql: `SELECT seq, payload FROM signals
              WHERE room_id = ? AND sender = ? AND seq > ?
              ORDER BY seq ASC LIMIT 50`,
        args: [id, other, after],
      },
      {
        sql: `UPDATE rooms SET last_activity = ?, expires_at = ? WHERE id = ? AND status = 'open'`,
        args: [now, now + ROOM_INACTIVITY_MS, id],
      },
      { sql: `SELECT guest_token FROM rooms WHERE id = ?`, args: [id] },
    ],
    "write",
  );

  const peerJoined = roomRes?.rows[0] ? roomRes.rows[0]["guest_token"] !== null : false;

  return json({
    messages: (msgsRes?.rows ?? []).map((r) => ({
      seq: Number(r["seq"]),
      payload: String(r["payload"]),
    })),
    peerJoined,
  });
}
