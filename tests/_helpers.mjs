import { pbkdf2Sync, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@libsql/client";

/** Carrega .env da raiz para process.env (sem dependência de dotenv). */
export function loadEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
    }
  } catch {
    // sem .env — segue com o ambiente atual
  }
}

// Resolvida a CADA chamada (não no import): o smoke de produção define
// process.env.BASE_URL depois de importar este módulo.
export function base() {
  return process.env.BASE_URL ?? "http://localhost:3000";
}

let passed = 0;
let failed = 0;

export function check(name, condition, extra = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok - ${name}`);
  } else {
    failed += 1;
    console.error(`  FALHOU - ${name}${extra ? ` :: ${extra}` : ""}`);
  }
}

export function summary(title) {
  console.log(`\n${title}: ${passed} ok, ${failed} falhas`);
  if (failed > 0) process.exit(1);
}

/**
 * Cria uma sala DIRETO no Turso (credenciais do .env): os testes de chamada não
 * dependem da senha do operador, que o dono do app troca no primeiro uso.
 */
export async function createRoomViaDb(roomPassword = null) {
  const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let roomId = "";
  for (const b of randomBytes(10)) roomId += alphabet[b % alphabet.length];
  const hostToken = randomBytes(32).toString("hex");
  const now = Date.now();
  // Mesmo formato do servidor: PBKDF2-SHA256, 100k iterações, salt/hash em hex.
  let hash = null;
  let salt = null;
  if (roomPassword) {
    salt = randomBytes(16).toString("hex");
    hash = pbkdf2Sync(roomPassword, Buffer.from(salt, "hex"), 100_000, 32, "sha256").toString("hex");
  }
  await db.execute({
    sql: `INSERT INTO rooms (id, password_hash, password_salt, host_token, guest_token,
            status, created_at, last_activity, expires_at)
          VALUES (?, ?, ?, ?, NULL, 'open', ?, ?, ?)`,
    args: [roomId, hash, salt, hostToken, now, now, now + 15 * 60 * 1000],
  });
  db.close();
  return { roomId, hostToken };
}

export async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`${base()}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // corpo não-JSON
  }
  return { status: res.status, data };
}
