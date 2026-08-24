// Valida um servidor TURN de verdade: abre um browser, força iceTransportPolicy
// 'relay' e confere se candidatos "typ relay" aparecem. Sem relay candidates,
// o TURN não serve — teste empírico antes de configurar em produção.
import { chromium } from "playwright";
import { loadEnv } from "../tests/_helpers.mjs";

loadEnv();

const CANDIDATES = [
  {
    name: "Open Relay Metered (80)",
    server: {
      urls: ["turn:staticauth.openrelay.metered.ca:80"],
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  },
  {
    name: "Open Relay Metered (443/tcp)",
    server: {
      urls: ["turn:staticauth.openrelay.metered.ca:443?transport=tcp"],
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  },
];

// TURN próprio via .env, se existir, entra na frente da fila.
if (process.env.TURN_URL && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
  CANDIDATES.unshift({
    name: `TURN do .env (${process.env.TURN_URL})`,
    server: {
      urls: [process.env.TURN_URL],
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL,
    },
  });
}

async function main() {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  await page.goto("about:blank");

  for (const { name, server } of CANDIDATES) {
    const candidates = await page.evaluate(async (srv) => {
      const pc = new RTCPeerConnection({ iceServers: [srv], iceTransportPolicy: "relay" });
      pc.createDataChannel("probe");
      const found = [];
      pc.onicecandidate = (e) => {
        if (e.candidate) found.push(e.candidate.candidate);
      };
      await pc.setLocalDescription(await pc.createOffer());
      await new Promise((r) => setTimeout(r, 8000));
      pc.close();
      return found;
    }, server);
    const relays = candidates.filter((c) => c.includes("typ relay"));
    console.log(
      `${relays.length > 0 ? "OK " : "FALHOU"} ${name}: ${relays.length} relay candidate(s)`,
    );
    for (const r of relays.slice(0, 2)) console.log(`    ${r}`);
  }

  await browser.close();
}

main().catch((err) => {
  console.error("Erro:", err);
  process.exit(1);
});
