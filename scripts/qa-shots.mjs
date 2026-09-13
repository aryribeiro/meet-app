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

  // Webchat: duas mensagens e captura no celular (palco não pode encolher).
  await host.evaluate(() => window.__meetQA.forceTier(0));
  await guest.evaluate(() => window.__meetQA.forceTier(0));
  const box = (p) => p.getByRole("textbox", { name: "Mensagem" });
  await box(host).fill("Oi! Está me ouvindo bem? Segue o link: https://exemplo.com/pauta");
  await box(host).press("Enter");
  await guest.getByText("Segue o link").waitFor({ timeout: 10000 });
  await box(guest).fill("Perfeito, ouço bem. Recebi o link.");
  await box(guest).press("Enter");
  await host.getByText("Recebi o link").waitFor({ timeout: 10000 });
  const bytes = Buffer.alloc(300 * 1024, 7);
  await host.locator("input[type=file][data-chat-file]").setInputFiles({ name: "Pauta da entrevista.pdf", mimeType: "application/pdf", buffer: bytes });
  await guest.locator('a[download="Pauta da entrevista.pdf"]').waitFor({ timeout: 20000 });
  await host.waitForTimeout(400);
  await host.screenshot({ path: `${OUT}/08-host-chat-1280.png` });
  await guest.screenshot({ path: `${OUT}/09-guest-chat-390.png`, fullPage: true });

  // Apresentação de tela: anfitrião compartilha um canvas; captura nos dois lados.
  await host.evaluate(() => window.__meetQA.shareTestScreen("#7c3aed"));
  await guest.locator('[data-tile="screen-remote"] video').waitFor({ timeout: 15000 });
  await guest.waitForTimeout(1200);
  await host.screenshot({ path: `${OUT}/10-host-presenting-1280.png`, fullPage: true });
  await guest.screenshot({ path: `${OUT}/11-guest-sees-screen-390.png`, fullPage: true });
  // Tela cheia (modo cinema): na apresentação (host) e no 50/50 (guest, celular).
  await host.getByRole("button", { name: "Tela cheia" }).click();
  await host.locator('[data-cinema="1"]').waitFor({ timeout: 5000 });
  await host.waitForTimeout(500);
  await host.screenshot({ path: `${OUT}/12-host-cinema-presenting-1280.png` });
  await host.keyboard.press("Escape");
  await host.evaluate(() => window.__meetQA.stopScreen());
  await guest.locator('[data-tile="screen-remote"]').waitFor({ state: "detached", timeout: 10000 });
  await guest.getByRole("button", { name: "Tela cheia" }).click();
  await guest.locator('[data-cinema="1"]').waitFor({ timeout: 5000 });
  await guest.waitForTimeout(500);
  await guest.screenshot({ path: `${OUT}/13-guest-cinema-390.png` });
  // Celular: controles escondidos até tocar no palco.
  await guest.locator('[data-tile="local"]').tap().catch(() => guest.locator('[data-tile="local"]').click());
  await guest.waitForTimeout(300);
  await guest.screenshot({ path: `${OUT}/13b-guest-cinema-tapped-390.png` });
  await guest.keyboard.press("Escape");

  // Home com o cartão de borda branca.
  const home = await mk({ width: 1280, height: 800 });
  await home.goto(`${BASE}/`);
  await home.waitForTimeout(500);
  await home.screenshot({ path: `${OUT}/14-home-1280.png` });
  console.log("capturas ok");
} finally {
  await browser.close();
}
