import { randomBytes, timingSafeEqual, webcrypto } from "node:crypto";

// PBKDF2 via Web Crypto: disponível no runtime Node da Vercel e sem dependência
// nativa (argon2/bcrypt quebram em serverless — decisão do contrato, PROMPT.md).
const PBKDF2_ITERATIONS = 100_000;
const KEY_BYTES = 32;

export interface HashedPassword {
  hash: string; // hex
  salt: string; // hex
}

async function derive(password: string, saltHex: string): Promise<Buffer> {
  const salt = Buffer.from(saltHex, "hex");
  const keyMaterial = await webcrypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await webcrypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
    keyMaterial,
    KEY_BYTES * 8,
  );
  return Buffer.from(bits);
}

/** Gera hash+salt novos (salt aleatório por senha — nunca reutilizado entre salas). */
export async function hashPassword(password: string): Promise<HashedPassword> {
  const salt = randomBytes(16).toString("hex");
  const derived = await derive(password, salt);
  return { hash: derived.toString("hex"), salt };
}

/** Comparação em tempo constante — evita timing attack sobre o hash armazenado. */
export async function verifyPassword(
  password: string,
  stored: HashedPassword,
): Promise<boolean> {
  const derived = await derive(password, stored.salt);
  const expected = Buffer.from(stored.hash, "hex");
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/** Token opaco aleatório (sessões do operador, tokens de sala). 256 bits. */
export function randomToken(): string {
  return randomBytes(32).toString("hex");
}

/** ID curto de sala, legível em URL (sem ambiguidade visual: sem 0/O, 1/l/I). */
export function roomId(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(10);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}
