// Constantes compartilhadas entre servidor e cliente.
// Limiares e TTLs definidos ANTES do código, conforme o contrato (PROMPT.md, emenda 3).

/** Intervalo do polling de sinalização (ms). */
export const POLL_INTERVAL_MS = 1000;

/** Timeout do handshake: se a conexão P2P não estabelecer nesse prazo, o cliente
 *  para o polling e desiste — nunca deixar polling infinito consumindo o free tier. */
export const HANDSHAKE_TIMEOUT_MS = 5 * 60 * 1000;

/** Sala expira após esse período sem nenhuma requisição autorizada (limpeza lazy). */
export const ROOM_INACTIVITY_MS = 15 * 60 * 1000;

/** Vida máxima absoluta de uma sala, mesmo ativa. */
export const ROOM_MAX_LIFE_MS = 24 * 60 * 60 * 1000;

/** Sessão do operador no painel. */
export const OPERATOR_SESSION_MS = 12 * 60 * 60 * 1000;

// ——— Adaptação de qualidade (histerese; PROMPT.md emenda 3) ———

/** Amostragem de getStats(). */
export const STATS_INTERVAL_MS = 2000;

/** Degrada quando: perda > 8% OU RTT > 400 ms, em 3 amostras consecutivas. */
export const DEGRADE_LOSS = 0.08;
export const DEGRADE_RTT_MS = 400;
export const DEGRADE_SAMPLES = 3;

/** Recupera quando: perda < 2% E RTT < 350 ms, em 5 amostras consecutivas.
 *  (Era 250 ms: em campo, 04/09, 5G via relay vive entre 250 e 400 ms — caía na
 *  zona morta, zerava a sequência boa e nunca voltava a HD.) */
export const RECOVER_LOSS = 0.02;
export const RECOVER_RTT_MS = 350;
export const RECOVER_SAMPLES = 5;

/** Bitrate de áudio (Opus adapta sozinho; nós só limitamos o teto via setParameters). */
export const AUDIO_BITRATE_NORMAL = 64_000;
export const AUDIO_BITRATE_DEGRADED = 16_000;

/** Teto de bitrate do vídeo 720p. */
export const VIDEO_MAX_BITRATE = 1_200_000;

// ——— Escada de qualidade (4 perfis; extensão da emenda 3, decidida no conselho de 2026-09-04) ———
// Cada lado adapta SÓ O QUE ENVIA (a métrica é o que o outro reporta receber).
// Ordem de sacrifício: resolução → vídeo → fidelidade da voz. A voz nunca cai.
//   0 = HD:        720p @ VIDEO_MAX_BITRATE + voz 64 kbps
//   1 = SD:        360p (scaleResolutionDownBy 2) @ VIDEO_SD_MAX_BITRATE + voz 64 kbps
//   2 = só voz HD: vídeo desligado (foto/inicial no outro lado) + voz 64 kbps
//   3 = voz básica: vídeo desligado + voz 16 kbps
export type QualityTier = 0 | 1 | 2 | 3;
export const TIER_HD: QualityTier = 0;
export const TIER_SD: QualityTier = 1;
export const TIER_AUDIO_HD: QualityTier = 2;
export const TIER_AUDIO_LOW: QualityTier = 3;
export const TIER_MAX: QualityTier = 3;

/** Perfil SD: metade da resolução (720p → 360p) e teto de 400 kbps. */
export const VIDEO_SD_SCALE = 2;
export const VIDEO_SD_MAX_BITRATE = 400_000;

/** Descida: DEGRADE_* em DEGRADE_SAMPLES amostras desce UM degrau.
 *  Perda SEVERA (só perda — RTT alto em relay é normal) pula direto para o
 *  perfil "só voz HD": esperar em vídeo destruído é jogar bitrate fora.
 *  Subida: RECOVER_* em RECOVER_SAMPLES amostras sobe UM degrau, nunca pula. */
export const SEVERE_LOSS = 0.2;

/** Amostra com menos pacotes novos que isto é ignorada (não decidir sobre ruído). */
export const MIN_DELTA_PACKETS = 20;

/** Largura de banda estimada pelo navegador (availableOutgoingBitrate). Só conta
 *  quando o encoder declara que está limitado pela REDE (qualityLimitationReason
 *  = "bandwidth") — no início da chamada a estimativa nasce baixa e sobe; sem
 *  esse gate a escada desceria à toa nos primeiros segundos.
 *  Abaixo de BWE_ENTER_BELOW[degrau] o degrau atual é "ruim"; para SUBIR a partir
 *  de um degrau, a estimativa precisa passar de BWE_RECOVER_ABOVE[degrau]. */
export const BWE_ENTER_BELOW: Record<QualityTier, number> = {
  0: 600_000,
  1: 200_000,
  2: 50_000,
  3: 0,
};
export const BWE_RECOVER_ABOVE: Record<QualityTier, number> = {
  0: Number.POSITIVE_INFINITY,
  1: 1_000_000,
  2: 450_000,
  3: 120_000,
};

/** Anti pisca-pisca adaptativo: subir e voltar a cair em menos de FLAP_WINDOW_MS
 *  dobra as amostras boas exigidas para a próxima subida (até FLAP_MAX_MULT×);
 *  FLAP_RESET_MS sem mudar de degrau zera o multiplicador. */
export const FLAP_WINDOW_MS = 60_000;
export const FLAP_MAX_MULT = 4;
export const FLAP_RESET_MS = 120_000;

// ——— Transferência via DataChannel (foto de fallback hoje; arquivos no futuro) ———

export const CHUNK_SIZE = 16 * 1024;
export const BUFFERED_AMOUNT_LOW = 64 * 1024;

/** Lado máximo da foto de perfil (redimensionada no cliente antes de enviar). */
export const AVATAR_MAX_SIDE = 256;
