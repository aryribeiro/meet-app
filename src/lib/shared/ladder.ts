// Escada de qualidade — máquina de estados PURA (sem browser, sem WebRTC):
// testável em Node (tests/ladder.test.mjs). Limiares em ./constants.
import {
  BWE_ENTER_BELOW,
  BWE_RECOVER_ABOVE,
  DEGRADE_LOSS,
  DEGRADE_RTT_MS,
  DEGRADE_SAMPLES,
  FLAP_MAX_MULT,
  FLAP_RESET_MS,
  FLAP_WINDOW_MS,
  RECOVER_LOSS,
  RECOVER_RTT_MS,
  RECOVER_SAMPLES,
  SEVERE_LOSS,
  TIER_AUDIO_HD,
  TIER_HD,
  TIER_MAX,
  TIER_SD,
  type QualityTier,
} from "./constants";

/** Por que o encoder está limitando a qualidade (getStats: qualityLimitationReason). */
export type LimitReason = "none" | "bandwidth" | "cpu" | "other";

export interface QualitySample {
  lossRatio: number;
  rttMs: number;
  /** Largura de banda de saída estimada pelo navegador (bps); undefined = navegador não expõe. */
  bweBps?: number;
  limitedBy?: LimitReason;
}

/**
 * - ruim: perda > 8% OU RTT > 400 ms OU (encoder limitado pela rede E estimativa
 *   abaixo do piso do degrau) OU (encoder limitado pelo processador, em HD)
 *   — em 3 amostras seguidas → desce 1 degrau;
 * - perda SEVERA (> 20%) em 3 amostras seguidas → pula direto para "só voz HD"
 *   (se já estiver lá ou abaixo, desce 1);
 * - bom: perda < 2% E RTT < 350 ms E estimativa acima do teto de subida do degrau
 *   E sem limitação de processador — em 5 amostras seguidas → sobe 1 degrau (nunca pula);
 * - zona morta zera as sequências: exige consistência real;
 * - anti pisca-pisca: subir e cair de novo em < 60 s dobra as amostras exigidas
 *   para a próxima subida (até 4×); 120 s estável zera.
 */
export class QualityLadder {
  private badStreak = 0;
  private severeStreak = 0;
  private goodStreak = 0;
  private current: QualityTier = TIER_HD;
  private recoverMult = 1;
  private lastUpAt = Number.NEGATIVE_INFINITY;
  private lastChangeAt = Number.NEGATIVE_INFINITY;

  get tier(): QualityTier {
    return this.current;
  }

  /** Quantas amostras boas seguidas a próxima subida exige (visível p/ QA). */
  get samplesToRecover(): number {
    return RECOVER_SAMPLES * this.recoverMult;
  }

  /** Coloca a escada num degrau (QA/forçado) e zera as sequências. */
  set(tier: QualityTier): void {
    this.current = tier;
    this.badStreak = 0;
    this.severeStreak = 0;
    this.goodStreak = 0;
  }

  /** Devolve o novo degrau quando ele MUDOU; null quando ficou onde estava. */
  feed(sample: QualitySample, nowMs: number = Date.now()): QualityTier | null {
    if (nowMs - this.lastChangeAt > FLAP_RESET_MS) this.recoverMult = 1;

    const bweKnown = typeof sample.bweBps === "number";
    const netLimited = sample.limitedBy === "bandwidth";
    const cpuLimited = sample.limitedBy === "cpu";

    const severe = sample.lossRatio > SEVERE_LOSS;
    const bad =
      sample.lossRatio > DEGRADE_LOSS ||
      sample.rttMs > DEGRADE_RTT_MS ||
      (netLimited && bweKnown && (sample.bweBps as number) < BWE_ENTER_BELOW[this.current]) ||
      (cpuLimited && this.current === TIER_HD);
    const good =
      !bad &&
      sample.lossRatio < RECOVER_LOSS &&
      sample.rttMs < RECOVER_RTT_MS &&
      !cpuLimited &&
      (!bweKnown || (sample.bweBps as number) > BWE_RECOVER_ABOVE[this.current]);

    if (bad) {
      this.badStreak += 1;
      this.severeStreak = severe ? this.severeStreak + 1 : 0;
      this.goodStreak = 0;
    } else if (good) {
      this.goodStreak += 1;
      this.badStreak = 0;
      this.severeStreak = 0;
    } else {
      this.badStreak = 0;
      this.severeStreak = 0;
      this.goodStreak = 0;
    }

    const before = this.current;
    if (this.badStreak >= DEGRADE_SAMPLES && this.current < TIER_MAX) {
      const jump = this.severeStreak >= DEGRADE_SAMPLES && this.current < TIER_AUDIO_HD;
      this.current = jump ? TIER_AUDIO_HD : ((this.current + 1) as QualityTier);
      this.badStreak = 0;
      this.severeStreak = 0;
      if (nowMs - this.lastUpAt < FLAP_WINDOW_MS) {
        this.recoverMult = Math.min(FLAP_MAX_MULT, this.recoverMult * 2);
      }
      this.lastChangeAt = nowMs;
    } else if (this.goodStreak >= this.samplesToRecover && this.current > TIER_HD) {
      this.current = (this.current - 1) as QualityTier;
      this.goodStreak = 0;
      this.lastUpAt = nowMs;
      this.lastChangeAt = nowMs;
    }
    return this.current === before ? null : this.current;
  }
}

/** Reexportado para o monitor decidir se um degrau envia vídeo. */
export const VIDEO_TIERS: readonly QualityTier[] = [TIER_HD, TIER_SD];
