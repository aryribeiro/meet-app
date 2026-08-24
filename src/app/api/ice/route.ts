import { json } from "@/lib/server/http";

export const runtime = "nodejs";

/**
 * Servidores ICE para o cliente. STUN público gratuito por padrão; TURN entra
 * SOMENTE se o operador configurou credenciais próprias no ambiente (contrato:
 * sem TURN configurado, o modo relay-only nem aparece na UI).
 * Nota de privacidade: as credenciais TURN precisam chegar ao cliente — é como
 * WebRTC funciona — mas são do TURN do próprio operador, não segredos do app.
 */
export async function GET(): Promise<Response> {
  const iceServers: RTCIceServer[] = [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  ];

  // TURN_URL aceita várias URLs separadas por vírgula (provedores entregam
  // variantes 80/443/tcp/tls — quanto mais caminhos, mais redes hostis passam).
  const turnUrl = process.env.TURN_URL;
  const turnUser = process.env.TURN_USERNAME;
  const turnCred = process.env.TURN_CREDENTIAL;
  const relayAvailable = Boolean(turnUrl && turnUser && turnCred);
  if (turnUrl && turnUser && turnCred) {
    const urls = turnUrl
      .split(",")
      .map((u) => u.trim())
      .filter(Boolean);
    iceServers.push({ urls, username: turnUser, credential: turnCred });
  }

  return json({ iceServers, relayAvailable });
}
