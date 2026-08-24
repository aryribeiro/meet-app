import { db } from "@/lib/server/db";
import { hashPassword, randomToken, roomId } from "@/lib/server/auth";
import {
  badRequest,
  checkOperatorSession,
  json,
  prepare,
  readBody,
  unauthorized,
} from "@/lib/server/http";
import { ROOM_INACTIVITY_MS } from "@/lib/shared/constants";

export const runtime = "nodejs";

/**
 * Criação de sala — somente o operador (PROMPT.md, emenda 1): é o que impede o
 * free tier de virar serviço público de sinalização e mantém o custo em zero.
 * Senha de sala opcional vira hash PBKDF2 + salt próprio (nunca em claro).
 */
export async function POST(req: Request): Promise<Response> {
  await prepare();
  const body = await readBody(req);
  if (!(await checkOperatorSession(body["token"]))) return unauthorized();

  const roomPassword = body["roomPassword"];
  if (roomPassword !== undefined && typeof roomPassword !== "string") {
    return badRequest("Senha da sala inválida.");
  }
  if (typeof roomPassword === "string" && roomPassword.length > 0 && roomPassword.length < 4) {
    return badRequest("A senha da sala precisa ter pelo menos 4 caracteres.");
  }

  let passwordHash: string | null = null;
  let passwordSalt: string | null = null;
  if (typeof roomPassword === "string" && roomPassword.length >= 4) {
    const hp = await hashPassword(roomPassword);
    passwordHash = hp.hash;
    passwordSalt = hp.salt;
  }

  const id = roomId();
  const hostToken = randomToken();
  const now = Date.now();
  await db().execute({
    sql: `INSERT INTO rooms
            (id, password_hash, password_salt, host_token, guest_token, status,
             created_at, last_activity, expires_at)
          VALUES (?, ?, ?, ?, NULL, 'open', ?, ?, ?)`,
    args: [id, passwordHash, passwordSalt, hostToken, now, now, now + ROOM_INACTIVITY_MS],
  });

  return json({ roomId: id, hostToken, requiresPassword: passwordHash !== null });
}
