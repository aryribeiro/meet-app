import { db } from "@/lib/server/db";
import { authRoom, json, prepare, readBody, unauthorized } from "@/lib/server/http";

export const runtime = "nodejs";

/**
 * Encerra a sala — qualquer um dos dois participantes pode. O link morre aqui:
 * status vira 'ended' e a limpeza lazy apaga sala + sinalização remanescente.
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

  const c = db();
  await c.batch(
    [
      { sql: `UPDATE rooms SET status = 'ended' WHERE id = ?`, args: [id] },
      { sql: `DELETE FROM signals WHERE room_id = ?`, args: [id] },
    ],
    "write",
  );
  return json({ ok: true });
}
