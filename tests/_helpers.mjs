import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

export const BASE = process.env.BASE_URL ?? "http://localhost:3000";

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

export async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
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
