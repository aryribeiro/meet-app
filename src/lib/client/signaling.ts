// Camada SIGNALING: caixa de correio no Turso via API routes + polling HTTP.
// Nenhuma outra camada conhece HTTP; nenhuma feature futura deve tocar aqui.
import { HANDSHAKE_TIMEOUT_MS, POLL_INTERVAL_MS } from "@/lib/shared/constants";

export type SignalPayload =
  | { kind: "description"; description: RTCSessionDescriptionInit }
  | { kind: "candidate"; candidate: RTCIceCandidateInit | null }
  | { kind: "bye" };

interface SignalingOptions {
  roomId: string;
  token: string;
  onMessage: (payload: SignalPayload) => void;
  onPeerJoined: () => void;
  onDead: (reason: "expired" | "timeout") => void;
}

/**
 * Canal de sinalização com controle explícito de polling:
 * - `wake()` liga o polling (handshake/renegociação);
 * - `sleep()` desliga quando a conexão P2P estabelece (contrato: nunca polling
 *   infinito consumindo o free tier);
 * - timeout duro de handshake: se ninguém conectar em HANDSHAKE_TIMEOUT_MS,
 *   o canal morre sozinho.
 */
export class SignalingChannel {
  private cursor = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private polling = false;
  private closed = false;
  private startedAt = Date.now();
  private readonly opts: SignalingOptions;

  constructor(opts: SignalingOptions) {
    this.opts = opts;
  }

  async post(payload: SignalPayload): Promise<void> {
    if (this.closed) return;
    try {
      const res = await fetch(`/api/rooms/${this.opts.roomId}/signal`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: this.opts.token, payload: JSON.stringify(payload) }),
      });
      if (res.status === 401 || res.status === 404) this.die("expired");
    } catch {
      // Falha transitória de rede: o próximo poll/post tenta de novo.
    }
  }

  /** Liga o polling (idempotente). */
  wake(): void {
    if (this.closed || this.polling) return;
    this.polling = true;
    this.startedAt = Date.now();
    void this.loop();
  }

  /** Desliga o polling (conexão estabelecida — economia de invocações). */
  sleep(): void {
    this.polling = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  close(): void {
    this.closed = true;
    this.sleep();
  }

  private die(reason: "expired" | "timeout"): void {
    if (this.closed) return;
    this.close();
    this.opts.onDead(reason);
  }

  private async loop(): Promise<void> {
    if (this.closed || !this.polling) return;
    if (Date.now() - this.startedAt > HANDSHAKE_TIMEOUT_MS) {
      this.die("timeout");
      return;
    }
    try {
      const res = await fetch(
        `/api/rooms/${this.opts.roomId}/signal?token=${this.opts.token}&after=${this.cursor}`,
        { cache: "no-store" },
      );
      if (res.status === 401 || res.status === 404) {
        this.die("expired");
        return;
      }
      if (res.ok) {
        const data: unknown = await res.json();
        const { messages, peerJoined } = data as {
          messages: Array<{ seq: number; payload: string }>;
          peerJoined: boolean;
        };
        if (peerJoined) this.opts.onPeerJoined();
        for (const m of messages) {
          this.cursor = Math.max(this.cursor, m.seq);
          try {
            this.opts.onMessage(JSON.parse(m.payload) as SignalPayload);
          } catch {
            // Payload malformado de peer com versão diferente: ignora, nunca derruba.
          }
        }
      }
    } catch {
      // Rede oscilou: mantém o ritmo e tenta no próximo tique.
    }
    if (this.polling && !this.closed) {
      this.timer = setTimeout(() => void this.loop(), POLL_INTERVAL_MS);
    }
  }
}

/** Encerra a sala no servidor (mata o link para sempre). */
export async function endRoom(roomId: string, token: string): Promise<void> {
  try {
    await fetch(`/api/rooms/${roomId}/end`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
      keepalive: true, // permite disparar durante unload da página
    });
  } catch {
    // A limpeza lazy do servidor cobre o pior caso.
  }
}
