// QA visual: conecta 2 browsers fake-media e tira capturas do palco (desktop +
// celular), incluindo o fallback de foto/inicial e os badges da escada de
// qualidade. OUT=<pasta> BASE_URL=<url> node scripts/qa-shots.mjs
import { chromium } from "playwright";
import { createRoomViaDb, loadEnv } from "../tests/_helpers.mjs";

loadEnv();
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT ?? ".";

async function joinAs(page, url, name) {
  await page.goto(url);
  await page.getByPlaceholder("Como o outro vai te ver").fill(name);
  await page.getByRole("button", { name: /Entrar/ }).click();
}

const { roomId, hostToken } = await createRoomViaDb();
const browser = await chromium.launch({
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});
try {
  const mk = async (vp) => {
    const ctx = await browser.newContext({ permissions: ["camera", "microphone"], viewport: vp });
    return ctx.newPage();
  };
  const host = await mk({ width: 1280, height: 800 });
  const guest = await mk({ width: 390, height: 844 });
  await joinAs(host, `${BASE}/sala/${roomId}#k=${hostToken}`, "Ana");
  await host.getByText("Aguardando o outro participante").waitFor({ timeout: 20000 });
  await host.waitForTimeout(1500);
  await host.screenshot({ path: `${OUT}/01-host-waiting-1280.png` });
  await joinAs(guest, `${BASE}/sala/${roomId}`, "Bruno");
  await host.getByText("Código de segurança").waitFor({ timeout: 30000 });
  await host.waitForTimeout(1500);
  await host.screenshot({ path: `${OUT}/02-host-connected-1280.png` });
  await guest.screenshot({ path: `${OUT}/03-guest-connected-390.png` });
  await host.getByRole("button", { name: /Conferimos/ }).click();
  await guest.getByRole("button", { name: "Desligar minha câmera" }).click();
  await host
    .locator('[data-tile="remote"] video.invisible')
    .waitFor({ state: "attached", timeout: 15000 });
  await host.waitForTimeout(500);
  await host.screenshot({ path: `${OUT}/04-host-remote-initial-1280.png` });
  await guest.getByRole("button", { name: "Ligar minha câmera" }).click();

  // Escada de qualidade: convidado manda em SD; anfitrião manda só voz básica.
  await guest.evaluate(() => window.__meetQA.forceTier(1));
  await host.locator('[data-tile="remote"] [data-tier="1"]').waitFor({ timeout: 10000 });
  await host.waitForTimeout(500);
  await host.screenshot({ path: `${OUT}/05-host-sees-guest-SD-1280.png` });
  await host.evaluate(() => window.__meetQA.forceTier(3));
  await guest.locator('[data-tile="remote"] [data-tier="3"]').waitFor({ timeout: 10000 });
  await guest.waitForTimeout(500);
  await guest.screenshot({ path: `${OUT}/06-guest-sees-host-voice-only-390.png` });
  await host.screenshot({ path: `${OUT}/07-host-sending-voice-only-1280.png` });
  console.log("capturas ok");
} finally {
  await browser.close();
}
