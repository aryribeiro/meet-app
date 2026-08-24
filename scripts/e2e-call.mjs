// E2E de chamada REAL: dois browsers (câmera/microfone falsos do Chromium),
// anfitrião + convidado, conexão P2P de verdade, comparação dos códigos SAS dos
// dois lados, mute e encerramento. Valida o que o teste de API não alcança.
import { chromium } from "playwright";
import { api, check, createRoomViaDb, loadEnv, summary } from "../tests/_helpers.mjs";

loadEnv();
const BASE = process.env.BASE_URL ?? "http://localhost:3000";

async function joinAs(page, url, name) {
  await page.goto(url);
  await page.getByPlaceholder("Como o outro vai te ver").fill(name);
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

    await joinAs(host, `${BASE}/sala/${roomId}#k=${hostToken}`, "Ana");
    await host.getByText("Aguardando o outro participante").waitFor({ timeout: 20000 });
    check("anfitrião vê estado de espera", true);

    await joinAs(guest, `${BASE}/sala/${roomId}`, "Bruno");

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
