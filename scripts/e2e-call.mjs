// E2E de chamada REAL: dois browsers (câmera/microfone falsos do Chromium),
// anfitrião + convidado, conexão P2P de verdade, comparação dos códigos SAS dos
// dois lados, mute e encerramento. Valida o que o teste de API não alcança.
import { createHash } from "node:crypto";
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
  // RELAY=1: força o modo relay-only (toggle de privacidade) — prova que a
  // mídia atravessa o TURN de verdade, não só que candidates existem.
  if (process.env.RELAY === "1") {
    const cb = page.locator("input[type=checkbox]");
    await cb.waitFor({ timeout: 10000 });
    await cb.check();
  }
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

    // WEBCHAT pelo canal direto: ida, volta, HTML hostil vira texto, teto de tamanho.
    const chatBox = (page) => page.getByRole("textbox", { name: "Mensagem" });
    await chatBox(host).fill("oi Bruno, link: https://exemplo.com/x");
    await chatBox(host).press("Enter");
    await guest.getByText("oi Bruno, link: https://exemplo.com/x").waitFor({ timeout: 10000 });
    check("chat: mensagem do anfitrião chegou ao convidado", true);
    const linkCount = await guest.locator('[data-chat-panel] a').count();
    check("chat: URL aparece como texto, sem virar link clicável", linkCount === 0);

    await chatBox(guest).fill("recebi!");
    await chatBox(guest).press("Enter");
    await host.getByText("recebi!").waitFor({ timeout: 10000 });
    check("chat: resposta do convidado chegou ao anfitrião", true);

    const hostile = '<img src=x onerror="document.title=\'pwned\'"><b>negrito</b>';
    await chatBox(guest).fill(hostile);
    await chatBox(guest).press("Enter");
    await host.getByText(hostile, { exact: true }).waitFor({ timeout: 10000 });
    const injected = await host.evaluate(() => ({
      img: document.querySelectorAll("[data-chat-panel] img").length,
      b: document.querySelectorAll("[data-chat-panel] b").length,
      title: document.title,
    }));
    check(
      "chat: HTML hostil vira texto literal (sem <img>/<b>, título intacto)",
      injected.img === 0 && injected.b === 0 && !injected.title.includes("pwned"),
      JSON.stringify(injected),
    );

    await chatBox(host).fill("x".repeat(5000));
    await chatBox(host).press("Enter");
    await guest.waitForFunction(
      () => [...document.querySelectorAll("[data-chat-text]")].some((p) => p.textContent.length === 2000),
      null,
      { timeout: 10000 },
    );
    check("chat: 5000 caracteres chegam cortados em 2000", true);

    // ARQUIVOS pelo canal direto: bytes iguais na chegada, recusas nos dois lados.
    const fileInput = (page) => page.locator("input[type=file][data-chat-file]");
    const payload = Buffer.alloc(200 * 1024);
    for (let i = 0; i < payload.length; i++) payload[i] = (i * 31 + 7) & 0xff;
    const expectedHash = createHash("sha256").update(payload).digest("hex");
    await fileInput(host).setInputFiles({ name: "relatorio.png", mimeType: "image/png", buffer: payload });
    await guest.locator('[data-chat-msg="peer"] a[download="relatorio.png"]').waitFor({ timeout: 20000 });
    const sameBytes = await guest.evaluate(async (expected) => {
      const a = document.querySelector('a[download="relatorio.png"]');
      const buf = await (await fetch(a.href)).arrayBuffer();
      const d = await crypto.subtle.digest("SHA-256", buf);
      const hex = Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
      return { same: hex === expected, size: buf.byteLength };
    }, expectedHash);
    check("arquivo: 200 KB chegaram no convidado com os MESMOS bytes (sha-256)", sameBytes.same, JSON.stringify(sameBytes));
    await host.locator('[data-chat-msg="me"] [data-chat-file-status="done"]').waitFor({ timeout: 10000 });
    check("arquivo: remetente marcou como enviado", true);

    await fileInput(host).setInputFiles({ name: "ferramenta.exe", mimeType: "application/octet-stream", buffer: Buffer.alloc(10) });
    await host.locator("[data-chat-notice]").waitFor({ timeout: 5000 });
    const exeOnGuest = await guest.locator('[data-chat-msg="peer"]', { hasText: "ferramenta.exe" }).count();
    check("arquivo: .exe recusado no remetente com aviso; nada chegou ao convidado", exeOnGuest === 0);

    await fileInput(host).setInputFiles({ name: "evil<>.png", mimeType: "image/png", buffer: Buffer.alloc(1024) });
    await guest.locator('[data-chat-msg="peer"] a[download="evil__.png"]').waitFor({ timeout: 15000 });
    check("arquivo: nome hostil chega sanitizado (evil<>.png → evil__.png)", true);

    // Guarda do RECEPTOR: o gancho de QA pula a checagem do remetente.
    await host.evaluate(() => window.__meetQA.sendRawFile("malware.exe", 2048));
    await host.evaluate(() => window.__meetQA.sendRawFile("gigante.zip", 1024)); // nome ok, tamanho ok → serve de sentinela
    await guest.locator('[data-chat-msg="peer"] a[download="gigante.zip"]').waitFor({ timeout: 15000 });
    const rawExe = await guest.locator('[data-chat-msg="peer"]', { hasText: "malware.exe" }).count();
    check("arquivo: receptor descarta .exe mesmo quando o remetente pula a checagem", rawExe === 0);

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
    await host.locator('[data-tile="remote"] img').waitFor({ state: "detached", timeout: 15000 });

    // ESCADA DE QUALIDADE (720p → SD → só voz HD → voz básica → volta): o
    // anfitrião força cada degrau pelo gancho de QA; a prova é dupla — o encoder
    // dele precisa refletir o perfil (getParameters) E o convidado precisa ver o
    // efeito (badge do tile remoto, foto no lugar do vídeo, vídeo voltando).
    const forceTier = (page, tier) => page.evaluate((t) => window.__meetQA.forceTier(t), tier);
    const encodings = (page) => page.evaluate(() => window.__meetQA.getEncodings());
    const waitTierBadge = (page, tier) =>
      page.locator(`[data-tile="remote"] [data-tier="${tier}"]`).waitFor({ timeout: 10000 });
    const alive = (vids) => vids.length === 2 && vids.every((v) => v.width > 0 && v.advancing);

    // Resolução que CHEGA no convidado (lida do <video>), antes de mexer na escada.
    const rxHeight = async (page) =>
      Number(
        await page
          .locator('[data-tile="remote"] [data-rx-height]')
          .first()
          .getAttribute("data-rx-height", { timeout: 10000 }),
      );
    const hdHeight = await rxHeight(guest);

    await forceTier(host, 1);
    await waitTierBadge(guest, 1);
    let enc = await encodings(host);
    check(
      "SD: encoder do anfitrião em metade da resolução e 400 kbps",
      enc.video?.scale === 2 && enc.video?.maxBitrate === 400000,
      JSON.stringify(enc),
    );
    check("SD: vídeo do anfitrião segue chegando no convidado", alive(await videosAlive(guest)));
    // Prova no fio: o convidado passa a RECEBER metade da altura (badge lê o <video>).
    await guest
      .locator(`[data-tile="remote"] [data-rx-height="${Math.round(hdHeight / 2)}"]`)
      .waitFor({ timeout: 15000 });
    check(
      `SD: convidado recebe ${Math.round(hdHeight / 2)}p de fato (era ${hdHeight}p)`,
      true,
    );
    // O relatório é amostrado a cada 2 s: esperar a amostra seguinte ao degrau novo.
    let rep = null;
    try {
      await host.waitForFunction(
        (h) => {
          const r = window.__meetQA.getReport();
          return r !== null && r.tier === 1 && r.sentHeight === h;
        },
        Math.round(hdHeight / 2),
        { timeout: 10000 },
      );
      rep = await host.evaluate(() => window.__meetQA.getReport());
    } catch {
      rep = await host.evaluate(() => window.__meetQA.getReport());
    }
    check(
      "SD: relatório do encoder do anfitrião reflete a altura enviada",
      rep !== null && rep.tier === 1 && rep.sentHeight === Math.round(hdHeight / 2),
      JSON.stringify(rep),
    );

    await forceTier(host, 2);
    await guest.locator('[data-tile="remote"] img').waitFor({ timeout: 10000 });
    await waitTierBadge(guest, 2);
    enc = await encodings(host);
    check(
      "Só voz HD: convidado vê a foto e a voz segue a 64 kbps",
      enc.audio?.maxBitrate === 64000,
      JSON.stringify(enc),
    );

    await forceTier(host, 3);
    await waitTierBadge(guest, 3);
    enc = await encodings(host);
    check("Voz básica: teto de áudio caiu para 16 kbps", enc.audio?.maxBitrate === 16000, JSON.stringify(enc));

    await forceTier(host, 0);
    await guest.locator('[data-tile="remote"] img').waitFor({ state: "detached", timeout: 10000 });
    await waitTierBadge(guest, 0);
    enc = await encodings(host);
    check(
      "HD restaurado: escala 1, 1,2 Mbps, voz 64 kbps e vídeo fluindo de novo",
      enc.video?.scale === 1 &&
        enc.video?.maxBitrate === 1200000 &&
        enc.audio?.maxBitrate === 64000 &&
        alive(await videosAlive(guest)),
      JSON.stringify(enc),
    );
    await forceTier(host, null); // solta a automação

    // ESTRESSE opcional (STRESS=N): N ciclos completos da escada nos DOIS lados
    // ao mesmo tempo; no fim de cada ciclo o vídeo precisa estar vivo nos dois.
    const cycles = Number(process.env.STRESS ?? 0);
    if (cycles > 0) {
      let okAll = true;
      const t0 = Date.now();
      for (let c = 0; c < cycles && okAll; c++) {
        for (const t of [1, 2, 3, 2, 1, 0]) {
          await Promise.all([forceTier(host, t), forceTier(guest, t)]);
          await Promise.all([waitTierBadge(guest, t), waitTierBadge(host, t)]);
        }
        const [vg, vh] = await Promise.all([videosAlive(guest), videosAlive(host)]);
        okAll = alive(vg) && alive(vh);
        if (!okAll) console.log(`  ciclo ${c + 1} falhou: ${JSON.stringify({ vg, vh })}`);
      }
      check(
        `estresse: ${cycles} ciclos da escada nos dois lados, vídeo vivo ao fim de cada um (${Math.round((Date.now() - t0) / 1000)} s)`,
        okAll,
      );
      await Promise.all([forceTier(host, null), forceTier(guest, null)]);
    }

    // APRESENTAÇÃO DE TELA: o gancho de QA compartilha um canvas de cor sólida
    // pelo MESMO caminho do getDisplayMedia; o outro lado precisa receber os
    // pixels (desenha o vídeo remoto num canvas e lê o centro) e mudar o palco.
    async function screenPixel(page) {
      return page.evaluate(async () => {
        const v = document.querySelector('[data-tile="screen-remote"] video');
        if (!v) return null;
        for (let i = 0; i < 40 && v.videoWidth === 0; i++) await new Promise((r) => setTimeout(r, 250));
        const c = document.createElement("canvas");
        c.width = v.videoWidth;
        c.height = v.videoHeight;
        const ctx = c.getContext("2d");
        ctx.drawImage(v, 0, 0);
        const [r, g, b] = ctx.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
        return { r, g, b, w: c.width, h: c.height };
      });
    }
    const isMagenta = (p) => p !== null && p.r > 200 && p.g < 80 && p.b > 200;
    const isCyan = (p) => p !== null && p.r < 80 && p.g > 200 && p.b > 200;

    await host.evaluate(() => window.__meetQA.shareTestScreen("#ff00ff"));
    await guest.locator('[data-tile="screen-remote"] video').waitFor({ timeout: 15000 });
    await guest.locator('[data-stage-mode="present"]').waitFor({ timeout: 5000 });
    check("tela: palco do convidado mudou para o modo apresentação", true);
    let px = null;
    for (let i = 0; i < 20 && !isMagenta(px); i++) {
      px = await screenPixel(guest);
      if (!isMagenta(px)) await guest.waitForTimeout(500);
    }
    check("tela: pixels da tela do anfitrião (magenta) chegaram no convidado", isMagenta(px), JSON.stringify(px));

    await host.getByRole("button", { name: "Parar de apresentar" }).click();
    await guest.locator('[data-tile="screen-remote"]').waitFor({ state: "detached", timeout: 10000 });
    await guest.locator('[data-stage-mode="split"]').waitFor({ timeout: 5000 });
    check("tela: parar devolveu o palco 50/50 no convidado", true);

    await guest.evaluate(() => window.__meetQA.shareTestScreen("#00ffff"));
    await host.locator('[data-tile="screen-remote"] video').waitFor({ timeout: 15000 });
    px = null;
    for (let i = 0; i < 20 && !isCyan(px); i++) {
      px = await screenPixel(host);
      if (!isCyan(px)) await host.waitForTimeout(500);
    }
    check("tela: pixels da tela do convidado (ciano) chegaram no anfitrião", isCyan(px), JSON.stringify(px));
    await guest.getByRole("button", { name: "Parar de apresentar" }).click();
    await host.locator('[data-tile="screen-remote"]').waitFor({ state: "detached", timeout: 10000 });

    // Depois de renegociar, o polling de sinalização tem de voltar a DORMIR nos
    // dois lados (contrato: nunca polling infinito consumindo o free tier).
    let pollingHost = true;
    let pollingGuest = true;
    for (let i = 0; i < 16 && (pollingHost || pollingGuest); i++) {
      await host.waitForTimeout(500);
      [pollingHost, pollingGuest] = await Promise.all([
        host.evaluate(() => window.__meetQA.isPolling()),
        guest.evaluate(() => window.__meetQA.isPolling()),
      ]);
    }
    check(
      "tela: polling voltou a dormir nos dois lados após as renegociações",
      !pollingHost && !pollingGuest,
      JSON.stringify({ pollingHost, pollingGuest }),
    );

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
