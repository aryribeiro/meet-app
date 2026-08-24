import { createClient, type Client } from "@libsql/client";
import { ROOM_INACTIVITY_MS, ROOM_MAX_LIFE_MS } from "@/lib/shared/constants";
import { hashPassword } from "./auth";

// Cliente Turso singleton por instância de Function (reuso de conexão entre invocações
// quentes — otimização barata que o plano do projeto pede).
let client: Client | null = null;

export function db(): Client {
  if (client) return client;
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) {
    throw new Error("TURSO_DATABASE_URL / TURSO_AUTH_TOKEN ausentes no ambiente.");
  }
  client = createClient({ url, authToken });
  return client;
}

// Semente inicial da senha do operador (PROMPT.md, emenda 1): a constante abaixo é
// "admin123" em base64 e serve EXCLUSIVAMENTE para semear o hash PBKDF2 no banco na
// primeira migração. Nunca é usada como verificação; a verificação sempre compara
// contra o hash armazenado no Turso, que o operador troca no painel.
const OPERATOR_SEED_B64 = "YWRtaW4xMjM=";

let schemaReady: Promise<void> | null = null;

/** Garante schema + semente. Roda uma vez por cold start; idempotente. */
export function ensureSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    const c = db();
    // batch = uma viagem de rede só (latência importa: cada request de polling passa aqui).
    await c.batch(
      [
        // Operador do serviço: linha única. Senha só como hash+salt (nunca em claro).
        `CREATE TABLE IF NOT EXISTS operator (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          password_hash TEXT NOT NULL,
          salt TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        )`,
        // Sessões do painel do operador (token aleatório, expira).
        `CREATE TABLE IF NOT EXISTS operator_sessions (
          token TEXT PRIMARY KEY,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        )`,
        // Salas: host_token emitido na criação; guest_token preenchido na entrada do
        // convidado por UPDATE atômico (vaga única — rejeita o 3º participante).
        // password_hash/salt: senha opcional da sala (PBKDF2). expires_at: expiração
        // por inatividade, renovada a cada requisição autorizada.
        `CREATE TABLE IF NOT EXISTS rooms (
          id TEXT PRIMARY KEY,
          password_hash TEXT,
          password_salt TEXT,
          host_token TEXT NOT NULL,
          guest_token TEXT,
          status TEXT NOT NULL DEFAULT 'open',
          created_at INTEGER NOT NULL,
          last_activity INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        )`,
        // Caixa de correio da sinalização: SDP/ICE efêmeros. Linhas são apagadas
        // quando o destinatário confirma leitura (ack por seq) e na limpeza lazy.
        `CREATE TABLE IF NOT EXISTS signals (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          room_id TEXT NOT NULL,
          sender TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS idx_signals_room ON signals(room_id, seq)`,
      ],
      "write",
    );

    // Semeia o operador se ainda não existir (primeira execução do app).
    const existing = await c.execute("SELECT id FROM operator WHERE id = 1");
    if (existing.rows.length === 0) {
      const seed = Buffer.from(OPERATOR_SEED_B64, "base64").toString("utf8");
      const { hash, salt } = await hashPassword(seed);
      await c.execute({
        sql: `INSERT OR IGNORE INTO operator (id, password_hash, salt, updated_at)
              VALUES (1, ?, ?, ?)`,
        args: [hash, salt, Date.now()],
      });
    }
  })();
  return schemaReady;
}

/**
 * Limpeza lazy (Vercel Hobby não tem cron de alta frequência): apaga sinalização de
 * salas mortas e as próprias salas expiradas/encerradas. Chamada em toda rota de API —
 * são dois DELETEs baratos e mantém a promessa de retenção zero.
 */
export async function lazyCleanup(): Promise<void> {
  const now = Date.now();
  const c = db();
  await c.batch(
    [
      {
        sql: `DELETE FROM signals WHERE room_id IN (
                SELECT id FROM rooms WHERE status = 'ended' OR expires_at < ? OR created_at < ?
              ) OR room_id NOT IN (SELECT id FROM rooms)`,
        args: [now, now - ROOM_MAX_LIFE_MS],
      },
      {
        sql: `DELETE FROM rooms WHERE status = 'ended' OR expires_at < ? OR created_at < ?`,
        args: [now, now - ROOM_MAX_LIFE_MS],
      },
      { sql: `DELETE FROM operator_sessions WHERE expires_at < ?`, args: [now] },
    ],
    "write",
  );
}

/** Renova a expiração por inatividade de uma sala (chamado em rotas autorizadas). */
export async function touchRoom(roomId: string): Promise<void> {
  const now = Date.now();
  await db().execute({
    sql: `UPDATE rooms SET last_activity = ?, expires_at = ? WHERE id = ? AND status = 'open'`,
    args: [now, now + ROOM_INACTIVITY_MS, roomId],
  });
}
