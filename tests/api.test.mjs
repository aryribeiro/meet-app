// Testes das API routes contra o servidor (local por padrão; BASE_URL para produção)
// e o Turso REAL. Cobre a definição de "concluído" do contrato:
// criação de sala, senha errada/certa, rejeição do 3º participante e expiração.
import { createClient } from "@libsql/client";
import { api, check, createRoomViaDb, loadEnv, summary } from "./_helpers.mjs";

loadEnv();

// Senha-semente só vale até o operador trocá-la no painel (fluxo desejado).
// Sem OPERATOR_PASSWORD válida, os testes de login/criação via API são pulados
// e as salas dos demais testes nascem direto no banco.
const OPERATOR_PASSWORD = process.env.OPERATOR_PASSWORD ?? "admin123";

async function main() {
  console.log("\n— Login do operador —");
  let r = await api("/api/operator/login", { method: "POST", body: { password: "senha-errada" } });
  check("senha errada é rejeitada (401)", r.status === 401);

  r = await api("/api/operator/login", { method: "POST", body: { password: OPERATOR_PASSWORD } });
  const session = r.status === 200 ? r.data?.token : null;
  if (session) {
    check("senha correta emite sessão", typeof session === "string");
  } else {
    console.log("  (senha do operador já foi trocada — login/criação via API pulados)");
  }

  console.log("\n— Criação de sala —");
  r = await api("/api/rooms", { method: "POST", body: { token: "token-invalido-".padEnd(40, "x") } });
  check("criar sala sem sessão é rejeitado (401)", r.status === 401);

  let roomId;
  let hostToken;
  if (session) {
    r = await api("/api/rooms", { method: "POST", body: { token: session, roomPassword: "segredo42" } });
    check(
      "sala com senha criada via API",
      r.status === 200 && typeof r.data?.roomId === "string" && r.data?.requiresPassword === true,
    );
    roomId = r.data?.roomId;
    hostToken = r.data?.hostToken;
  } else {
    ({ roomId, hostToken } = await createRoomViaDb("segredo42"));
    check("sala com senha criada via banco", Boolean(roomId && hostToken));
  }
  if (!roomId || !hostToken) return summary("API");

  console.log("\n— Info pública da sala —");
  r = await api(`/api/rooms/${roomId}`);
  check("info diz que pede senha", r.status === 200 && r.data?.requiresPassword === true);
  check("vaga ainda livre", r.data?.seatTaken === false);

  console.log("\n— Entrada do convidado —");
  r = await api(`/api/rooms/${roomId}/join`, { method: "POST", body: {} });
  check("sem senha é rejeitado (400)", r.status === 400);
  r = await api(`/api/rooms/${roomId}/join`, { method: "POST", body: { password: "errada" } });
  check("senha errada é rejeitada (401)", r.status === 401);
  r = await api(`/api/rooms/${roomId}/join`, { method: "POST", body: { password: "segredo42" } });
  check("senha certa emite token de sala", r.status === 200 && typeof r.data?.guestToken === "string");
  const guestToken = r.data?.guestToken;

  r = await api(`/api/rooms/${roomId}/join`, { method: "POST", body: { password: "segredo42" } });
  check("3º participante é rejeitado (409)", r.status === 409);

  console.log("\n— Sinalização protegida por token —");
  r = await api(`/api/rooms/${roomId}/signal`, {
    method: "POST",
    body: { token: "x".repeat(64), payload: "espiao" },
  });
  check("postar sem token válido é rejeitado (401)", r.status === 401);
  r = await api(`/api/rooms/${roomId}/signal`, {
    method: "POST",
    body: { token: hostToken, payload: JSON.stringify({ kind: "ping" }) },
  });
  check("anfitrião posta sinalização", r.status === 200);
  r = await api(`/api/rooms/${roomId}/signal?token=${guestToken}&after=0`);
  check(
    "convidado recebe a mensagem",
    r.status === 200 && r.data?.messages?.length === 1,
    JSON.stringify(r.data),
  );

  console.log("\n— Encerramento —");
  r = await api(`/api/rooms/${roomId}/end`, { method: "POST", body: { token: guestToken } });
  check("qualquer participante encerra", r.status === 200);
  r = await api(`/api/rooms/${roomId}`);
  check("sala encerrada some (404)", r.status === 404);
  r = await api(`/api/rooms/${roomId}/signal?token=${hostToken}&after=0`);
  check("sinalização morre com a sala (401)", r.status === 401);

  console.log("\n— Expiração por inatividade (forçada via banco) —");
  const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  let expRoom;
  if (session) {
    r = await api("/api/rooms", { method: "POST", body: { token: session } });
    expRoom = r.data?.roomId;
    check("sala sem senha criada", r.status === 200 && typeof expRoom === "string");
  } else {
    ({ roomId: expRoom } = await createRoomViaDb());
    check("sala sem senha criada (via banco)", typeof expRoom === "string");
  }
  await db.execute({
    sql: "UPDATE rooms SET expires_at = ? WHERE id = ?",
    args: [Date.now() - 1000, expRoom],
  });
  r = await api(`/api/rooms/${expRoom}`);
  check("sala expirada some (404)", r.status === 404);
  const gone = await db.execute({ sql: "SELECT id FROM rooms WHERE id = ?", args: [expRoom] });
  check("limpeza lazy apagou a linha da sala", gone.rows.length === 0);
  db.close();

  summary("API");
}

main().catch((err) => {
  console.error("Erro fatal nos testes:", err);
  process.exit(1);
});
