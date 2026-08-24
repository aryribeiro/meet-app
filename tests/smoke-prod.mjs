// Smoke test de PRODUÇÃO (PROMPT.md, emenda 2): roda contra a URL real após o
// deploy. Não cria salas se a senha do operador já tiver sido trocada — nesse
// caso valida o que dá sem segredo (páginas, API viva, banco alcançável).
import { api, check, loadEnv, summary } from "./_helpers.mjs";

loadEnv();
const BASE = process.env.BASE_URL ?? "https://meet2026.vercel.app";
process.env.BASE_URL = BASE;
const OPERATOR_PASSWORD = process.env.OPERATOR_PASSWORD ?? "admin123";

async function page(path) {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, body: await res.text() };
}

async function main() {
  console.log(`Smoke contra ${BASE}\n`);

  let r = await page("/");
  check("home responde 200 com o nome do app", r.status === 200 && r.body.includes("Meet App!"));
  r = await page("/privacidade");
  check("nota de privacidade no ar", r.status === 200);
  r = await page("/painel");
  check("painel no ar", r.status === 200);

  r = await api("/api/ice");
  check("API /ice viva", r.status === 200 && Array.isArray(r.data?.iceServers));

  r = await api("/api/rooms/salaquenaoexiste");
  check("sala inexistente responde 404 (banco alcançável)", r.status === 404);

  r = await api("/api/operator/login", { method: "POST", body: { password: "senha-errada-xyz" } });
  check("login errado rejeitado (401)", r.status === 401);

  r = await api("/api/operator/login", { method: "POST", body: { password: OPERATOR_PASSWORD } });
  if (r.status !== 200) {
    console.log(
      "\n(senha do operador já foi trocada — ciclo completo de sala pulado; smoke parcial ok)",
    );
    summary("Smoke produção");
    return;
  }
  const session = r.data?.token;
  check("login do operador ok", Boolean(session));

  r = await api("/api/rooms", { method: "POST", body: { token: session, roomPassword: "smoke123" } });
  const { roomId, hostToken } = r.data ?? {};
  check("sala criada em produção", Boolean(roomId && hostToken));

  r = await api(`/api/rooms/${roomId}/join`, { method: "POST", body: { password: "errada" } });
  check("senha errada rejeitada", r.status === 401);
  r = await api(`/api/rooms/${roomId}/join`, { method: "POST", body: { password: "smoke123" } });
  const guestToken = r.data?.guestToken;
  check("convidado entrou", Boolean(guestToken));
  r = await api(`/api/rooms/${roomId}/join`, { method: "POST", body: { password: "smoke123" } });
  check("3º participante rejeitado (409)", r.status === 409);

  await api(`/api/rooms/${roomId}/signal`, {
    method: "POST",
    body: { token: hostToken, payload: JSON.stringify({ kind: "smoke" }) },
  });
  r = await api(`/api/rooms/${roomId}/signal?token=${guestToken}&after=0`);
  check("sinalização atravessa em produção", r.status === 200 && r.data?.messages?.length === 1);

  r = await api(`/api/rooms/${roomId}/end`, { method: "POST", body: { token: hostToken } });
  check("sala encerrada", r.status === 200);
  r = await api(`/api/rooms/${roomId}`);
  check("link morto (404)", r.status === 404);

  summary("Smoke produção");
}

main().catch((err) => {
  console.error("Erro fatal no smoke:", err);
  process.exit(1);
});
