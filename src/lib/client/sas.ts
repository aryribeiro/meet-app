// SAS (Short Authentication String): fecha a alegação de privacidade contra o
// operador. Como a sinalização passa pelo servidor, um operador malicioso poderia
// fazer MITM trocando os fingerprints DTLS. O SAS deriva um código curto dos
// fingerprints dos DOIS lados; os participantes comparam em voz alta — vozes que
// eles reconhecem, canal que o servidor não controla. Códigos iguais = sem MITM.

/** Extrai o fingerprint DTLS (a=fingerprint) de um SDP. */
export function extractFingerprint(sdp: string): string | null {
  const match = sdp.match(/a=fingerprint:\S+\s+([0-9A-Fa-f:]+)/);
  return match?.[1] ? match[1].toUpperCase() : null;
}

/**
 * Deriva o código de 6 dígitos a partir dos dois fingerprints.
 * ORDEM CANÔNICA (PROMPT.md, emenda 4): ordenação lexicográfica, nunca
 * "local primeiro" — senão cada lado exibiria um código diferente e o usuário
 * veria um falso alarme de MITM.
 */
export async function deriveSas(
  localFingerprint: string,
  remoteFingerprint: string,
): Promise<string> {
  const [a, b] = [localFingerprint, remoteFingerprint].sort();
  const data = new TextEncoder().encode(`meet-app-sas-v1|${a}|${b}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  // 4 bytes → inteiro → 6 dígitos (com zeros à esquerda), exibidos "123 456".
  const n =
    (((bytes[0] ?? 0) << 24) | ((bytes[1] ?? 0) << 16) | ((bytes[2] ?? 0) << 8) | (bytes[3] ?? 0)) >>>
    0;
  const six = String(n % 1_000_000).padStart(6, "0");
  return `${six.slice(0, 3)} ${six.slice(3)}`;
}

/** Deriva o SAS a partir das descrições atuais da conexão (pós-handshake). */
export async function sasFromConnection(pc: RTCPeerConnection): Promise<string | null> {
  const localSdp = pc.currentLocalDescription?.sdp;
  const remoteSdp = pc.currentRemoteDescription?.sdp;
  if (!localSdp || !remoteSdp) return null;
  const local = extractFingerprint(localSdp);
  const remote = extractFingerprint(remoteSdp);
  if (!local || !remote) return null;
  return deriveSas(local, remote);
}
