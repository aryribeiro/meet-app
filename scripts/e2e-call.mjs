// E2E de chamada REAL: dois browsers (câmera/microfone falsos do Chromium),
// anfitrião + convidado, conexão P2P de verdade, comparação dos códigos SAS dos
// dois lados, mute e encerramento. Valida o que o teste de API não alcança.
import { chromium } from "playwright";
import { api, check, createRoomViaDb, loadEnv, summary } from "../tests/_helpers.mjs";

loadEnv();
const BASE = process.env.BASE_URL ?? "http://localhost:3000";

/** Escolhe uma foto de perfil de cor sólida direto no browser (sem arquivo em disco). */
async function pickSolidPhoto(page, color) {
  await page.evaluate(async (c) => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, 64, 64);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
    const file = new File([blob], "foto.png", { type: "image/png" });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.querySelector("input[type=file]");
    input.files = dt.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, color);
}

/** Amostra a cor central da foto de fallback exibida na tela grande (o outro peer). */
async function sampleAvatarColor(page) {
  return page.evaluate(async () => {
    const img = document.querySelector('[data-tile="remote"] img');
    if (!img) return null;
    if (!img.complete) await new Promise((r) => (img.onload = r));
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const [r, g, b] = ctx.getImageData(
      Math.floor(canvas.width / 2),
      Math.floor(canvas.height / 2),
      1,
      1,
    ).data;
    return { r, g, b };
  });
}

async function joinAs(page, url, name, photoColor = null) {
  await page.goto(url);
  await page.getByPlaceholder("Como o outro vai te ver").fill(name);
  if (photoColor) await pickSolidPhoto(page, photoColor);
  const button = page.getByRole("button", { name: "Entrar na conversa" });
  await button.waitFor({ state: "visible" });
  // O botão habilita quando o preview de mídia está pronto.
  await page.waitForFunction(
    () => {
      const b = [...document.querySelectorAll("button")].find((x) =>
        x.textContent?.includes("Entrar na conversa"),
      );
      return b && !b.disabled;
    },
    { timeout: 20000 },
  );
  await button.click();
}

async function readSas(page) {
  const el = page.locator("strong.text-lg");
  await el.waitFor({ state: "visible", timeout: 45000 });
  return (await el.textContent())?.trim();
}

async function main() {
  const { roomId, hostToken } = await createRoomViaDb();
  check("sala criada para o e2e", Boolean(roomId && hostToken));
  let r;

  const browser = await chromium.launch({
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  try {
    const ctxHost = await browser.newContext({ permissions: ["camera", "microphone"] });
    const ctxGuest = await browser.newContext({ permissions: ["camera", "microphone"] });
    const host = await ctxHost.newPage();
    const guest = await ctxGuest.newPage();

    await joinAs(host, `${BASE}/sala/${roomId}#k=${hostToken}`, "Ana", "#ff0000");
    await host.getByText("Aguardando o outro participante").waitFor({ timeout: 20000 });
    check("anfitrião vê estado de espera", true);

    await joinAs(guest, `${BASE}/sala/${roomId}`, "Bruno", "#0000ff");

    // SAS aparece só com a conexão P2P estabelecida — é a prova da chamada real.
    const sasHost = await readSas(host);
    const sasGuest = await readSas(guest);
    console.log(`  SAS anfitrião: ${sasHost} | SAS convidado: ${sasGuest}`);
    check("conexão P2P estabeleceu (SAS visível nos dois lados)", Boolean(sasHost && sasGuest));
    check("códigos SAS IGUAIS nos dois lados (ordem canônica ok)", sasHost === sasGuest);

    // VÍDEO DE VERDADE fluindo (pega o bug do track parado na pré-chamada):
    // todo <video> da tela precisa ter dimensões reais e o relógio andando.
    async function videosAlive(page) {
      return page.evaluate(async () => {
        const vids = [...document.querySelectorAll("video")];
        const before = vids.map((v) => v.currentTime);
        await new Promise((r) => setTimeout(r, 1500));
        return vids.map((v, i) => ({
          width: v.videoWidth,
          advancing: v.currentTime > before[i],
        }));
      });
    }
    for (const [who, page] of [["anfitrião", host], ["convidado", guest]]) {
      const vids = await videosAlive(page);
      check(
        `${who}: ${vids.length} vídeos com pixels reais e reproduzindo`,
        vids.length === 2 && vids.every((v) => v.width > 0 && v.advancing),
        JSON.stringify(vids),
      );
    }

    // Perfis trafegaram pelo DataChannel.
    await guest.getByText("Ana", { exact: false }).first().waitFor({ timeout: 15000 });
    await host.getByText("Bruno", { exact: false }).first().waitFor({ timeout: 15000 });
    check("nomes trocados via canal direto", true);

    // Mute do microfone: o outro lado deve mostrar o indicador 🔇.
    await host.getByRole("button", { name: "Desligar meu microfone" }).click();
    await guest.locator("[title='Microfone desligado']").waitFor({ timeout: 10000 });
    check("mute refletiu no outro participante", true);

    // Painel de dispositivos: abre, "troca" para o mesmo dispositivo fake (exercita
    // getUserMedia + replaceTrack + resync do preview) e o vídeo precisa seguir vivo.
    await host.getByRole("button", { name: "Escolher câmera e microfone" }).click();
    const selects = host.locator("select");
    await selects.first().waitFor({ timeout: 10000 });
    const nSelects = await selects.count();
    check("painel de dispositivos lista seletores", nSelects >= 1);
    for (let i = 0; i < nSelects; i++) {
      const sel = selects.nth(i);
      const value = await sel.inputValue();
      if (value) await sel.selectOption(value);
    }
    await host.waitForTimeout(2000);
    const vidsAfterSwitch = await videosAlive(host);
    check(
      "vídeo local segue vivo após troca de dispositivo",
      vidsAfterSwitch.length === 2 && vidsAfterSwitch.every((v) => v.width > 0 && v.advancing),
      JSON.stringify(vidsAfterSwitch),
    );
    await host.getByRole("button", { name: "Fechar dispositivos" }).click();

    // FALLBACK DE FOTO nos dois sentidos: câmera desligada → o OUTRO lado deve
    // exibir a foto escolhida (que viajou pelo DataChannel), com a cor certa.
    await host.getByRole("button", { name: "Desligar minha câmera" }).click();
    await guest.locator('[data-tile="remote"] img').waitFor({ timeout: 15000 });
    const redSeen = await sampleAvatarColor(guest);
    check(
      "convidado vê a FOTO (vermelha) do anfitrião com a câmera desligada",
      redSeen !== null && redSeen.r > 200 && redSeen.g < 80 && redSeen.b < 80,
      JSON.stringify(redSeen),
    );

    await guest.getByRole("button", { name: "Desligar minha câmera" }).click();
    await host.locator('[data-tile="remote"] img').waitFor({ timeout: 15000 });
    const blueSeen = await sampleAvatarColor(host);
    check(
      "anfitrião vê a FOTO (azul) do convidado com a câmera desligada",
      blueSeen !== null && blueSeen.b > 200 && blueSeen.g < 80 && blueSeen.r < 80,
      JSON.stringify(blueSeen),
    );

    // Religar as câmeras: o vídeo deve substituir a foto de volta.
    await host.getByRole("button", { name: "Ligar minha câmera" }).click();
    await guest
      .locator('[data-tile="remote"] img')
      .waitFor({ state: "detached", timeout: 15000 });
    check("vídeo do anfitrião voltou ao religar a câmera", true);
    await guest.getByRole("button", { name: "Ligar minha câmera" }).click();

    // Encerramento pelo convidado: anfitrião deve ver a tela de fim e o link morrer.
    await guest.getByRole("button", { name: /Encerrar a conversa/ }).click();
    await host.getByText("Conversa encerrada").waitFor({ timeout: 15000 });
    check("anfitrião soube do encerramento", true);

    // O aviso de fim chega ao outro peer pelo canal direto ANTES de o HTTP de
    // encerramento completar — dá alguns segundos para o servidor registrar.
    let dead = false;
    for (let i = 0; i < 5 && !dead; i++) {
      r = await api(`/api/rooms/${roomId}`);
      dead = r.status === 404;
      if (!dead) await new Promise((res) => setTimeout(res, 1000));
    }
    check("link morto após encerrar (404)", dead);
  } finally {
    await browser.close();
  }
  summary("E2E chamada");
}

main().catch((err) => {
  console.error("Erro fatal no e2e:", err);
  process.exit(1);
});
