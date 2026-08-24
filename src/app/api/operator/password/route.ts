import { db } from "@/lib/server/db";
import { hashPassword } from "@/lib/server/auth";
import {
  badRequest,
  checkOperatorSession,
  json,
  prepare,
  readBody,
  unauthorized,
} from "@/lib/server/http";

export const runtime = "nodejs";

/** Troca da senha do operador (exige sessão válida). */
export async function POST(req: Request): Promise<Response> {
  await prepare();
  const body = await readBody(req);
  if (!(await checkOperatorSession(body["token"]))) return unauthorized();

  const newPassword = body["newPassword"];
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    return badRequest("A nova senha precisa ter pelo menos 8 caracteres.");
  }
  if (newPassword === "admin123") {
    return badRequest("Escolha uma senha diferente da inicial.");
  }

  const { hash, salt } = await hashPassword(newPassword);
  await db().execute({
    sql: "UPDATE operator SET password_hash = ?, salt = ?, updated_at = ? WHERE id = 1",
    args: [hash, salt, Date.now()],
  });
  // Invalida todas as sessões antigas exceto a atual — troca de senha derruba
  // qualquer sessão eventualmente vazada.
  await db().execute({
    sql: "DELETE FROM operator_sessions WHERE token != ?",
    args: [String(body["token"])],
  });
  return json({ ok: true });
}
