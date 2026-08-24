// Simula DOIS peers trocando offer/answer/ICE pelas rotas REAIS (Turso real).
// É a prova exigida pelo contrato: se o SDP atravessar em poucos segundos,
// a arquitetura de sinalização por polling vive.
import { api, check, loadEnv, summary } from "../tests/_helpers.mjs";

loadEnv();
const OPERATOR_PASSWORD = process.env.OPERATOR_PASSWORD ?? "admin123";
const POLL_MS = 1000;
const FAKE_SDP_OFFER = "v=0\r\no=- 46117 2 IN IP4 127.0.0.1\r\n" + "a=fake-offer ".repeat(200);
const FAKE_SDP_ANSWER = "v=0\r\no=- 46118 2 IN IP4 127.0.0.1\r\n" + "a=fake-answer ".repeat(200);

async function pollUntil(roomId, token, after, predicate, timeoutMs = 15000) {
  const start = Date.now();
  let cursor = after;
  const got = [];
  while (Date.now() - start < timeoutMs) {
    const r = await api(`/api/rooms/${roomId}/signal?token=${token}&after=${cursor}`);
    if (r.status === 200 && r.data?.messages?.length) {
      for (const m of r.data.messages) {
        got.push(m);
        cursor = Math.max(cursor, m.seq);
      }
      if (predicate(got)) return { got, cursor, elapsed: Date.now() - start };
    }
    await new Promise((res) => setTimeout(res, POLL_MS));
  }
  return { got, cursor, elapsed: Date.now() - start };
}

async function main() {
  let r = await api("/api/operator/login", { method: "POST", body: { password: OPERATOR_PASSWORD } });
  const session = r.data?.token;
  check("login do operador", Boolean(session));

  r = await api("/api/rooms", { method: "POST", body: { token: session } });
  const roomId = r.data?.roomId;
  const hostToken = r.data?.hostToken;
  check("sala criada", Boolean(roomId && hostToken));

  r = await api(`/api/rooms/${roomId}/join`, { method: "POST", body: {} });
  const guestToken = r.data?.guestToken;
  check("convidado entrou", Boolean(guestToken));

  // Anfitrião envia OFFER; convidado deve recebê-la via polling.
  const t0 = Date.now();
  await api(`/api/rooms/${roomId}/signal`, {
    method: "POST",
    body: { token: hostToken, payload: JSON.stringify({ kind: "description", sdp: FAKE_SDP_OFFER, type: "offer" }) },
  });
  const offerTrip = await pollUntil(roomId, guestToken, 0, (msgs) =>
    msgs.some((m) => JSON.parse(m.payload).type === "offer"),
  );
  check(
    `convidado recebeu a offer (${offerTrip.elapsed} ms)`,
    offerTrip.got.some((m) => JSON.parse(m.payload).type === "offer"),
  );

  // Convidado responde ANSWER; anfitrião deve recebê-la.
  await api(`/api/rooms/${roomId}/signal`, {
    method: "POST",
    body: { token: guestToken, payload: JSON.stringify({ kind: "description", sdp: FAKE_SDP_ANSWER, type: "answer" }) },
  });
  const answerTrip = await pollUntil(roomId, hostToken, 0, (msgs) =>
    msgs.some((m) => JSON.parse(m.payload).type === "answer"),
  );
  check(
    `anfitrião recebeu a answer (${answerTrip.elapsed} ms)`,
    answerTrip.got.some((m) => JSON.parse(m.payload).type === "answer"),
  );

  // ICE candidates nos dois sentidos (3 de cada lado).
  for (let i = 0; i < 3; i++) {
    await api(`/api/rooms/${roomId}/signal`, {
      method: "POST",
      body: { token: hostToken, payload: JSON.stringify({ kind: "candidate", candidate: `cand-host-${i}` }) },
    });
    await api(`/api/rooms/${roomId}/signal`, {
      method: "POST",
      body: { token: guestToken, payload: JSON.stringify({ kind: "candidate", candidate: `cand-guest-${i}` }) },
    });
  }
  const hostIce = await pollUntil(roomId, hostToken, answerTrip.cursor, (msgs) =>
    msgs.filter((m) => JSON.parse(m.payload).kind === "candidate").length >= 3,
  );
  const guestIce = await pollUntil(roomId, guestToken, offerTrip.cursor, (msgs) =>
    msgs.filter((m) => JSON.parse(m.payload).kind === "candidate").length >= 3,
  );
  check("anfitrião recebeu 3 candidates", hostIce.got.filter((m) => JSON.parse(m.payload).kind === "candidate").length >= 3);
  check("convidado recebeu 3 candidates", guestIce.got.filter((m) => JSON.parse(m.payload).kind === "candidate").length >= 3);

  const total = Date.now() - t0;
  console.log(`\nHandshake completo (offer+answer+ICE) em ${total} ms`);
  check("handshake abaixo de 10 s", total < 10_000);

  await api(`/api/rooms/${roomId}/end`, { method: "POST", body: { token: hostToken } });
  summary("Handshake");
}

main().catch((err) => {
  console.error("Erro fatal na simulação:", err);
  process.exit(1);
});
