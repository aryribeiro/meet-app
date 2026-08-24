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

/** Recupera quando: perda < 2% E RTT < 250 ms, em 5 amostras consecutivas. */
export const RECOVER_LOSS = 0.02;
export const RECOVER_RTT_MS = 250;
export const RECOVER_SAMPLES = 5;

/** Bitrate de áudio (Opus adapta sozinho; nós só limitamos o teto via setParameters). */
export const AUDIO_BITRATE_NORMAL = 64_000;
export const AUDIO_BITRATE_DEGRADED = 16_000;

/** Teto de bitrate do vídeo 720p. */
export const VIDEO_MAX_BITRATE = 1_200_000;

// ——— Transferência via DataChannel (foto de fallback hoje; arquivos no futuro) ———

export const CHUNK_SIZE = 16 * 1024;
export const BUFFERED_AMOUNT_LOW = 64 * 1024;

/** Lado máximo da foto de perfil (redimensionada no cliente antes de enviar). */
export const AVATAR_MAX_SIDE = 256;
