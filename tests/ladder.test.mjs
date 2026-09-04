// Teste da escada de qualidade em Node puro (sem browser): a máquina de estados
// é a mesma que roda na chamada (src/lib/shared/ladder.ts, importado direto —
// Node 24 remove os tipos ao carregar).
import { QualityLadder } from "../src/lib/shared/ladder.ts";
import {
  DEGRADE_SAMPLES,
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

function feedN(ladder, sample, n) {
  let last = null;
  for (let i = 0; i < n; i++) {
    const r = ladder.feed(sample);
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

// 4) RTT alto sem perda (relay) nunca pula degrau.
{
  const l = new QualityLadder();
  feedN(l, RTT_ONLY, DEGRADE_SAMPLES);
  check("RTT alto sem perda desce só um degrau (HD → SD)", l.tier === TIER_SD);
}

// 5) Histerese: oscilação e zona morta não movem a escada.
{
  const l = new QualityLadder();
  for (let i = 0; i < 20; i++) {
    l.feed(BAD);
    l.feed(GOOD);
  }
  check("alternar ruim/bom 20x não mexe (histerese)", l.tier === TIER_HD);
  feedN(l, BAD, DEGRADE_SAMPLES - 1);
  l.feed(DEAD);
  feedN(l, BAD, DEGRADE_SAMPLES - 1);
  check("zona morta zera a sequência ruim", l.tier === TIER_HD);
  l.set(TIER_SD);
  feedN(l, GOOD, RECOVER_SAMPLES - 1);
  l.feed(DEAD);
  feedN(l, GOOD, RECOVER_SAMPLES - 1);
  check("zona morta zera a sequência boa", l.tier === TIER_SD);
}

// 6) feed() só devolve valor quando o degrau muda.
{
  const l = new QualityLadder();
  const results = [];
  for (let i = 0; i < DEGRADE_SAMPLES; i++) results.push(l.feed(BAD));
  check(
    "feed devolve null até mudar e o degrau novo na mudança",
    results.slice(0, -1).every((r) => r === null) && results.at(-1) === TIER_SD,
    JSON.stringify(results),
  );
}

summary("Escada de qualidade");
