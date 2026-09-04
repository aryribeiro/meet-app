// Teste da escada de qualidade em Node puro (sem browser): a máquina de estados
// é a mesma que roda na chamada (src/lib/shared/ladder.ts, importado direto —
// Node 24 remove os tipos ao carregar).
import { QualityLadder } from "../src/lib/shared/ladder.ts";
import {
  DEGRADE_SAMPLES,
  FLAP_RESET_MS,
  RECOVER_SAMPLES,
  TIER_AUDIO_HD,
  TIER_AUDIO_LOW,
  TIER_HD,
  TIER_SD,
} from "../src/lib/shared/constants.ts";
import { check, summary } from "./_helpers.mjs";

const GOOD = { lossRatio: 0, rttMs: 60 };
const BAD = { lossRatio: 0.1, rttMs: 100 }; // perda 10%: ruim, não severa
const SEVERE = { lossRatio: 0.3, rttMs: 100 }; // perda 30%
const RTT_ONLY = { lossRatio: 0, rttMs: 900 }; // RTT alto sem perda (relay)
const DEAD = { lossRatio: 0.05, rttMs: 300 }; // zona morta da histerese
const RELAY_OK = { lossRatio: 0, rttMs: 300 }; // 5G via relay: RTT 300 ms sem perda

let clock = 0;
const tick = () => (clock += 2000);
function feedN(ladder, sample, n) {
  let last = null;
  for (let i = 0; i < n; i++) {
    const r = ladder.feed(sample, tick());
    if (r !== null) last = r;
  }
  return last;
}

// 1) Descida um degrau por vez com perda comum.
{
  const l = new QualityLadder();
  feedN(l, BAD, DEGRADE_SAMPLES - 1);
  check("ruim abaixo do limiar de amostras não mexe", l.tier === TIER_HD);
  feedN(l, BAD, 1);
  check("3 amostras ruins: HD → SD", l.tier === TIER_SD);
  feedN(l, BAD, DEGRADE_SAMPLES);
  check("mais 3 ruins: SD → só voz HD", l.tier === TIER_AUDIO_HD);
  feedN(l, BAD, DEGRADE_SAMPLES);
  check("mais 3 ruins: só voz HD → voz básica", l.tier === TIER_AUDIO_LOW);
  feedN(l, BAD, DEGRADE_SAMPLES * 3);
  check("no fundo da escada fica no fundo", l.tier === TIER_AUDIO_LOW);
}

// 2) Subida sempre um degrau por vez, mais lenta que a descida.
{
  const l = new QualityLadder();
  l.set(TIER_AUDIO_LOW);
  feedN(l, GOOD, RECOVER_SAMPLES - 1);
  check("bom abaixo do limiar de amostras não sobe", l.tier === TIER_AUDIO_LOW);
  feedN(l, GOOD, 1);
  check("5 boas: voz básica → só voz HD (áudio volta primeiro)", l.tier === TIER_AUDIO_HD);
  feedN(l, GOOD, RECOVER_SAMPLES);
  check("5 boas: só voz HD → SD (vídeo volta em SD)", l.tier === TIER_SD);
  feedN(l, GOOD, RECOVER_SAMPLES);
  check("5 boas: SD → HD (tudo restaurado)", l.tier === TIER_HD);
  feedN(l, GOOD, RECOVER_SAMPLES * 3);
  check("no topo fica no topo", l.tier === TIER_HD);
}

// 3) Perda severa pula direto para só voz; abaixo disso desce um por vez.
{
  const l = new QualityLadder();
  feedN(l, SEVERE, DEGRADE_SAMPLES);
  check("perda severa em HD pula direto para só voz HD", l.tier === TIER_AUDIO_HD);
  feedN(l, SEVERE, DEGRADE_SAMPLES);
  check("perda severa em só voz desce só um (voz básica)", l.tier === TIER_AUDIO_LOW);
}

// 4) RTT alto sem perda (relay) nunca pula; RTT de relay (300 ms) não impede subir.
{
  const l = new QualityLadder();
  feedN(l, RTT_ONLY, DEGRADE_SAMPLES);
  check("RTT alto sem perda desce só um degrau (HD → SD)", l.tier === TIER_SD);
  feedN(l, RELAY_OK, RECOVER_SAMPLES);
  check("RTT 300 ms sem perda (5G via relay) volta a HD — bug de campo 04/09", l.tier === TIER_HD);
}

// 5) Histerese: oscilação e zona morta não movem a escada.
{
  const l = new QualityLadder();
  for (let i = 0; i < 20; i++) {
    l.feed(BAD, tick());
    l.feed(GOOD, tick());
  }
  check("alternar ruim/bom 20x não mexe (histerese)", l.tier === TIER_HD);
  feedN(l, BAD, DEGRADE_SAMPLES - 1);
  l.feed(DEAD, tick());
  feedN(l, BAD, DEGRADE_SAMPLES - 1);
  check("zona morta zera a sequência ruim", l.tier === TIER_HD);
  l.set(TIER_SD);
  feedN(l, GOOD, RECOVER_SAMPLES - 1);
  l.feed(DEAD, tick());
  feedN(l, GOOD, RECOVER_SAMPLES - 1);
  check("zona morta zera a sequência boa", l.tier === TIER_SD);
}

// 6) feed() só devolve valor quando o degrau muda.
{
  const l = new QualityLadder();
  const results = [];
  for (let i = 0; i < DEGRADE_SAMPLES; i++) results.push(l.feed(BAD, tick()));
  check(
    "feed devolve null até mudar e o degrau novo na mudança",
    results.slice(0, -1).every((r) => r === null) && results.at(-1) === TIER_SD,
    JSON.stringify(results),
  );
}

// 7) Largura de banda: só conta quando o encoder diz "limitado pela rede".
{
  const l = new QualityLadder();
  feedN(l, { ...GOOD, bweBps: 300_000, limitedBy: "none" }, DEGRADE_SAMPLES * 2);
  check("estimativa baixa no início (sem limitação declarada) NÃO desce", l.tier === TIER_HD);
  feedN(l, { ...GOOD, bweBps: 300_000, limitedBy: "bandwidth" }, DEGRADE_SAMPLES);
  check("limitado pela rede com 300 kbps: HD → SD", l.tier === TIER_SD);
  feedN(l, { ...GOOD, bweBps: 300_000, limitedBy: "bandwidth" }, DEGRADE_SAMPLES);
  check("300 kbps ainda serve para SD (piso 200k): fica em SD", l.tier === TIER_SD);
  feedN(l, { ...GOOD, bweBps: 100_000, limitedBy: "bandwidth" }, DEGRADE_SAMPLES);
  check("100 kbps: SD → só voz HD", l.tier === TIER_AUDIO_HD);
  feedN(l, { ...GOOD, bweBps: 800_000, limitedBy: "none" }, RECOVER_SAMPLES);
  check("800 kbps: só voz → SD (teto de subida 450k)", l.tier === TIER_SD);
  feedN(l, { ...GOOD, bweBps: 800_000, limitedBy: "none" }, RECOVER_SAMPLES * 2);
  check("800 kbps NÃO basta para voltar a HD (precisa > 1 Mbps)", l.tier === TIER_SD);
  feedN(l, { ...GOOD, bweBps: 1_300_000, limitedBy: "none" }, RECOVER_SAMPLES);
  check("1,3 Mbps: SD → HD", l.tier === TIER_HD);
  const f = new QualityLadder();
  f.set(TIER_SD);
  feedN(f, { ...GOOD }, RECOVER_SAMPLES);
  check("navegador sem estimativa (Firefox): sobe só por perda/RTT", f.tier === TIER_HD);
}

// 8) Processador do celular: HD → SD; em SD a limitação de CPU não derruba o vídeo.
{
  const l = new QualityLadder();
  feedN(l, { ...GOOD, limitedBy: "cpu" }, DEGRADE_SAMPLES);
  check("limitado pelo processador em HD: HD → SD", l.tier === TIER_SD);
  feedN(l, { ...GOOD, limitedBy: "cpu" }, DEGRADE_SAMPLES * 3);
  check("limitado pelo processador em SD: fica em SD (não vira foto)", l.tier === TIER_SD);
  feedN(l, { ...GOOD, limitedBy: "cpu" }, RECOVER_SAMPLES * 2);
  check("com CPU limitada não sobe para HD", l.tier === TIER_SD);
  feedN(l, { ...GOOD, limitedBy: "none" }, RECOVER_SAMPLES);
  check("CPU liberada: SD → HD", l.tier === TIER_HD);
}

// 9) Anti pisca-pisca adaptativo: cair logo depois de subir dobra a exigência.
{
  const l = new QualityLadder();
  l.set(TIER_SD);
  feedN(l, GOOD, RECOVER_SAMPLES);
  check("sobe para HD com 5 boas", l.tier === TIER_HD && l.samplesToRecover === RECOVER_SAMPLES);
  feedN(l, BAD, DEGRADE_SAMPLES); // caiu < 60 s depois de subir
  check("caiu logo depois: próxima subida exige o dobro", l.tier === TIER_SD && l.samplesToRecover === RECOVER_SAMPLES * 2);
  feedN(l, GOOD, RECOVER_SAMPLES);
  check("5 boas já não bastam", l.tier === TIER_SD);
  feedN(l, GOOD, RECOVER_SAMPLES);
  check("10 boas sobem", l.tier === TIER_HD);
  feedN(l, BAD, DEGRADE_SAMPLES);
  check("caiu de novo: 4× (teto)", l.samplesToRecover === RECOVER_SAMPLES * 4);
  feedN(l, BAD, DEGRADE_SAMPLES);
  check("teto de 4× respeitado", l.samplesToRecover === RECOVER_SAMPLES * 4);
  clock += FLAP_RESET_MS + 1;
  l.feed(DEAD, tick());
  check("120 s estável zera o multiplicador", l.samplesToRecover === RECOVER_SAMPLES);
}

summary("Escada de qualidade");
