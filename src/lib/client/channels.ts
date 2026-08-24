// Camada CHANNELS: protocolo tipado e versionado sobre o RTCDataChannel.
// Tudo que trafega aqui é ponta a ponta (DTLS) — o servidor nunca vê.
// Extensível por design (contrato): chat/arquivos futuros = registrar handler novo.
import { BUFFERED_AMOUNT_LOW, CHUNK_SIZE } from "@/lib/shared/constants";

export const PROTOCOL_VERSION = 1;

/** Envelope de toda mensagem JSON do DataChannel. */
export interface Envelope<T = unknown> {
  v: number;
  type: string;
  payload: T;
}

export interface ProfilePayload {
  name: string;
}

export interface MediaStatePayload {
  camOn: boolean;
  micOn: boolean;
  /** true quando o remetente degradou o próprio vídeo para foto (qualidade ruim). */
  fallback: boolean;
}

export interface FileMetaPayload {
  id: string;
  /** Propósito do blob — o transporte não sabe que "avatar" é a foto de perfil. */
  purpose: string;
  mime: string;
  size: number;
}

interface FileEndPayload {
  id: string;
}

type Handler = (payload: unknown) => void;

interface IncomingFile {
  meta: FileMetaPayload;
  chunks: ArrayBuffer[];
  received: number;
}

/**
 * Encapsula um RTCDataChannel com:
 * - envelope { v, type, payload } + registro de handlers por type;
 * - tipos desconhecidos ignorados com log (compat entre versões dos peers);
 * - transferência de blobs em chunks com backpressure (bufferedAmountLow) —
 *   hoje transporta a foto de fallback; amanhã, arquivos genéricos.
 */
export class TypedChannel {
  private dc: RTCDataChannel | null = null;
  private readonly handlers = new Map<string, Handler>();
  private readonly fileHandlers = new Map<string, (meta: FileMetaPayload, blob: Blob) => void>();
  private incoming: IncomingFile | null = null;
  private readonly sendQueue: Array<() => void> = [];
  private opened = false;

  attach(dc: RTCDataChannel): void {
    this.dc = dc;
    dc.binaryType = "arraybuffer";
    dc.bufferedAmountLowThreshold = BUFFERED_AMOUNT_LOW;
    dc.onopen = () => {
      this.opened = true;
      for (const fn of this.sendQueue.splice(0)) fn();
    };
    dc.onmessage = (ev: MessageEvent<unknown>) => this.onMessage(ev.data);
  }

  get isOpen(): boolean {
    return this.opened && this.dc?.readyState === "open";
  }

  on(type: string, handler: Handler): void {
    this.handlers.set(type, handler);
  }

  onFile(purpose: string, handler: (meta: FileMetaPayload, blob: Blob) => void): void {
    this.fileHandlers.set(purpose, handler);
  }

  send(type: string, payload: unknown): void {
    const doSend = () => {
      if (this.dc?.readyState === "open") {
        const envelope: Envelope = { v: PROTOCOL_VERSION, type, payload };
        this.dc.send(JSON.stringify(envelope));
      }
    };
    if (this.isOpen) doSend();
    else this.sendQueue.push(doSend);
  }

  /** Envia um blob em chunks respeitando backpressure. */
  async sendBlob(purpose: string, blob: Blob): Promise<void> {
    if (!this.isOpen) {
      await new Promise<void>((resolve) => this.sendQueue.push(resolve));
    }
    const dc = this.dc;
    if (!dc || dc.readyState !== "open") return;
    const id = Math.random().toString(36).slice(2);
    const meta: FileMetaPayload = { id, purpose, mime: blob.type, size: blob.size };
    this.send("file-meta", meta);

    const buffer = await blob.arrayBuffer();
    for (let offset = 0; offset < buffer.byteLength; offset += CHUNK_SIZE) {
      if (dc.readyState !== "open") return;
      // Backpressure: espera o buffer esvaziar antes de empurrar mais.
      if (dc.bufferedAmount > BUFFERED_AMOUNT_LOW) {
        await new Promise<void>((resolve) => {
          dc.onbufferedamountlow = () => {
            dc.onbufferedamountlow = null;
            resolve();
          };
        });
      }
      dc.send(buffer.slice(offset, offset + CHUNK_SIZE));
    }
    this.send("file-end", { id } satisfies FileEndPayload);
  }

  private onMessage(data: unknown): void {
    if (typeof data === "string") {
      let envelope: Envelope;
      try {
        envelope = JSON.parse(data) as Envelope;
      } catch {
        return; // lixo — ignora, nunca derruba a conexão
      }
      if (envelope.type === "file-meta") {
        const meta = envelope.payload as FileMetaPayload;
        this.incoming = { meta, chunks: [], received: 0 };
        return;
      }
      if (envelope.type === "file-end") {
        if (this.incoming) {
          const { meta, chunks } = this.incoming;
          this.incoming = null;
          const handler = this.fileHandlers.get(meta.purpose);
          if (handler) handler(meta, new Blob(chunks, { type: meta.mime }));
        }
        return;
      }
      const handler = this.handlers.get(envelope.type);
      if (handler) handler(envelope.payload);
      else console.debug(`[channels] type desconhecido ignorado: ${envelope.type}`);
      return;
    }
    if (data instanceof ArrayBuffer && this.incoming) {
      this.incoming.chunks.push(data);
      this.incoming.received += data.byteLength;
    }
  }
}
