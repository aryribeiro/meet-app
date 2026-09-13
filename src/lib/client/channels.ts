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
  /** true quando o remetente degradou o próprio vídeo para foto (qualidade ruim).
   *  Mantido por compatibilidade: é derivado de `tier >= 2`. */
  fallback: boolean;
  /** Degrau da escada de qualidade em que o remetente está ENVIANDO (0 HD … 3 voz
   *  básica). Opcional: um peer de versão anterior não manda — cai no `fallback`. */
  tier?: number;
}

/** Webchat: type "chat" — modelo e validação em @/lib/shared/chat. */
export type { ChatPayload } from "@/lib/shared/chat";

/** Apresentação de tela: type "screen" — avisa ANTES do track qual fluxo é a tela. */
export interface ScreenPayload {
  on: boolean;
  /** id do MediaStream da tela (o mesmo id chega no ontrack do outro lado). */
  streamId: string;
}

export interface FileMetaPayload {
  id: string;
  /** Propósito do blob — o transporte não sabe que "avatar" é a foto de perfil. */
  purpose: string;
  mime: string;
  size: number;
  /** Nome (arquivos do chat). O receptor sanitiza; o transporte só carrega. */
  name?: string;
}

export interface SendBlobOptions {
  name?: string;
  onProgress?: (sentBytes: number, total: number) => void;
}

interface FileEndPayload {
  id: string;
}

type Handler = (payload: unknown) => void;

interface IncomingFile {
  meta: FileMetaPayload;
  chunks: ArrayBuffer[];
  received: number;
  /** Cabeçalho recusado pelo guarda do propósito: pedaços são descartados. */
  dropped: boolean;
}

/** Guarda por propósito: decide, pelo cabeçalho, se os pedaços serão aceitos. */
type FileGate = (meta: FileMetaPayload) => boolean;

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
  private readonly fileGates = new Map<string, FileGate>();
  private readonly fileProgress = new Map<string, (meta: FileMetaPayload, received: number) => void>();
  private incoming: IncomingFile | null = null;
  private readonly sendQueue: Array<() => void> = [];
  /** Um blob por vez no canal ordenado: envios encadeados, nunca intercalados. */
  private blobChain: Promise<void> = Promise.resolve();
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

  /** Guarda do cabeçalho: false = pedaços descartados em silêncio (nunca derruba). */
  onFileGate(purpose: string, gate: FileGate): void {
    this.fileGates.set(purpose, gate);
  }

  onFileProgress(purpose: string, cb: (meta: FileMetaPayload, received: number) => void): void {
    this.fileProgress.set(purpose, cb);
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

  /** Envia um blob em chunks respeitando backpressure. Envios são serializados:
   *  o canal é único e ordenado, e o receptor remonta um arquivo por vez.
   *  Resolve true se o arquivo inteiro saiu; false se o canal fechou no meio. */
  sendBlob(purpose: string, blob: Blob, opts: SendBlobOptions = {}): Promise<boolean> {
    const run = () => this.sendBlobNow(purpose, blob, opts);
    const result = this.blobChain.then(run, run);
    this.blobChain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async sendBlobNow(purpose: string, blob: Blob, opts: SendBlobOptions): Promise<boolean> {
    if (!this.isOpen) {
      await new Promise<void>((resolve) => this.sendQueue.push(resolve));
    }
    const dc = this.dc;
    if (!dc || dc.readyState !== "open") return false;
    const id = Math.random().toString(36).slice(2);
    const meta: FileMetaPayload = { id, purpose, mime: blob.type, size: blob.size };
    if (opts.name) meta.name = opts.name;
    this.send("file-meta", meta);

    const buffer = await blob.arrayBuffer();
    let sent = 0;
    for (let offset = 0; offset < buffer.byteLength; offset += CHUNK_SIZE) {
      if (dc.readyState !== "open") return false;
      // Backpressure: espera o buffer esvaziar antes de empurrar mais.
      if (dc.bufferedAmount > BUFFERED_AMOUNT_LOW) {
        await new Promise<void>((resolve) => {
          dc.onbufferedamountlow = () => {
            dc.onbufferedamountlow = null;
            resolve();
          };
        });
      }
      const piece = buffer.slice(offset, offset + CHUNK_SIZE);
      dc.send(piece);
      sent += piece.byteLength;
      opts.onProgress?.(sent, buffer.byteLength);
    }
    if (dc.readyState !== "open") return false;
    this.send("file-end", { id } satisfies FileEndPayload);
    return true;
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
        if (typeof meta?.purpose !== "string" || typeof meta?.size !== "number") return;
        const gate = this.fileGates.get(meta.purpose);
        // Sem handler para o propósito (peer mais novo?) ou guarda recusou: descarta.
        const dropped = !this.fileHandlers.has(meta.purpose) || (gate ? !gate(meta) : false);
        this.incoming = { meta, chunks: [], received: 0, dropped };
        return;
      }
      if (envelope.type === "file-end") {
        if (this.incoming) {
          const { meta, chunks, dropped, received } = this.incoming;
          this.incoming = null;
          // Tamanho anunciado ≠ recebido: remontagem suspeita, fora.
          if (dropped || received !== meta.size) return;
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
      const inc = this.incoming;
      inc.received += data.byteLength;
      if (inc.dropped) return; // pedaços de arquivo recusado não ocupam memória
      if (inc.received > inc.meta.size) {
        // Mandou mais do que anunciou: abandona tudo, nunca estoura memória.
        inc.dropped = true;
        inc.chunks.length = 0;
        return;
      }
      inc.chunks.push(data);
      this.fileProgress.get(inc.meta.purpose)?.(inc.meta, inc.received);
    }
  }
}
