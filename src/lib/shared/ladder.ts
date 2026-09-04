// Escada de qualidade — máquina de estados PURA (sem browser, sem WebRTC):
// testável em Node (tests/ladder.test.mjs). Limiares em ./constants.
import {
  DEGRADE_LOSS,
  DEGRADE_RTT_MS,
  DEGRADE_SAMPLES,
  RECOVER_LOSS,
  RECOVER_RTT_MS,
  RECOVER_SAMPLES,
  SEVERE_LOSS,
  TIER_AUDIO_HD,
  TIER_HD,
  TIER_MAX,
  type QualityTier,
} from "./constants";

export interface QualitySample {
  lossRatio: number;
  rttMs: number;
}

/**
 * - ruim (perda > 8% OU RTT > 400 ms) em 3 amostras seguidas → desce 1 degrau;
 * - perda SEVERA (> 20%) em 3 amostras seguidas → pula direto para "só voz HD"
 *   (se já estiver lá ou abaixo, desce 1);
 * - bom (perda < 2% E RTT < 250 ms) em 5 amostras seguidas → sobe 1 degrau (nunca pula);
 * - zona morta zera as sequências: exige consistência real.
 * Assimetria descer-rápido/subir-devagar é o que impede o pisca-pisca.
 */
export class QualityLadder {
  private badStreak = 0;
  private severeStreak = 0;
  private goodStreak = 0;
  private current: QualityTier = TIER_HD;

  get tier(): QualityTier {
    return this.current;
  }

  /** Coloca a escada num degrau (QA/forçado) e zera as sequências. */
  set(tier: QualityTier): void {
    this.current = tier;
    this.badStreak = 0;
    this.severeStreak = 0;
    this.goodStreak = 0;
  }

  /** Devolve o novo degrau quando ele MUDOU; null quando ficou onde estava. */
  feed(sample: QualitySample): QualityTier | null {
    const severe = sample.lossRatio > SEVERE_LOSS;
    const bad = sample.lossRatio > DEGRADE_LOSS || sample.rttMs > DEGRADE_RTT_MS;
    const good = sample.lossRatio < RECOVER_LOSS && sample.rttMs < RECOVER_RTT_MS;

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
    } else if (this.goodStreak >= RECOVER_SAMPLES && this.current > TIER_HD) {
      this.current = (this.current - 1) as QualityTier;
      this.goodStreak = 0;
    }
    return this.current === before ? null : this.current;
  }
}
