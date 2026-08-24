# PROMPT.md — Contrato de construção do "Meet App!" (v2 emendado pelo Conselho)

Este documento é o contrato de arquitetura do projeto. Base: `prompt_meet_privado_fable5_v2.md`,
adotado pelo Conselho de LLM em 2026-08-24 com **quatro emendas obrigatórias** (abaixo).
Decisões aqui registradas sobrevivem a qualquer conversa.

## Emendas do Conselho (prevalecem sobre o texto-base)

1. **Gate do operador corrigido.** Papéis sem ambiguidade:
   - *Operador* = dono do serviço (administra o app, cria reuniões no painel).
   - *Anfitrião* = papel do operador dentro de uma sala; *Convidado* = quem entra pelo link.
   Somente o operador cria salas (isso mantém o free tier sustentável). A senha do operador
   vive como **hash PBKDF2 + salt no Turso**, semeada na migração a partir da constante
   base64 (`admin123` inicial) e mutável no painel. Base64 **jamais** é usado como
   verificação e **nenhuma** checagem de senha acontece no cliente.
2. **Smoke test de produção reimportado do v1.** Além do checklist humano (browser/câmera),
   um smoke automatizado das API routes roda contra `https://meet2026.vercel.app` após o deploy
   (`npm run smoke:prod`).
3. **Limiares numéricos com histerese, definidos antes do código** (adaptação de qualidade):
   - Amostragem via `getStats()` a cada 2 s.
   - **Degrada** (vídeo→foto + áudio 16 kbps): perda de pacotes > 8% **ou** RTT > 400 ms
     em **3 amostras consecutivas**.
   - **Recupera** (vídeo volta + áudio 64 kbps): perda < 2% **e** RTT < 250 ms
     em **5 amostras consecutivas**.
4. **SAS com ordem canônica.** Os dois fingerprints DTLS (local e remoto) são ordenados
   lexicograficamente antes do hash SHA-256 — nunca "local primeiro" — para que os dois
   lados exibam o mesmo código.

## Arquitetura fechada (do v2)

- **Mídia:** WebRTC mesh 1:1 (P2P, sem SFU/MCU), SRTP/DTLS nativo. Nenhum áudio/vídeo toca o servidor.
- **Sinalização:** caixa de correio no Turso (libSQL) + polling HTTP ~1 s via Vercel Functions.
  Sem WebSocket/Socket.io/Pusher/Ably/Redis. Polling **para** quando a conexão estabelece;
  reabre só para renegociação/ICE restart. Timeout de handshake: 5 min.
- **Glare:** perfect negotiation (convidado = polite, anfitrião = impolite). ICE restart automático em falha.
- **NAT:** STUN público por padrão. Relay-only (TURN) só aparece na UI se `TURN_URL`/`TURN_USERNAME`/`TURN_CREDENTIAL` existirem no ambiente.
- **Retenção:** sinalização apagada quando consumida; salas expiradas limpas lazy nas próprias requisições. Sem analytics/tracking.
- **Foto de perfil/fallback:** trafega só pelo RTCDataChannel (chunks com backpressure). Nunca sobe ao servidor.
- **Senha de sala (opcional):** hash PBKDF2 + salt por sala. Token de sala emitido na entrada
  protege as rotas de sinalização — a senha protege a sinalização, não só a UI.
- **Vaga atômica:** `UPDATE ... WHERE guest_token IS NULL` conferindo linhas afetadas. 3ª conexão rejeitada.
- **Extensibilidade (não implementar agora):** chat, arquivos e apresentação de tela entram como
  handlers novos no protocolo tipado do DataChannel (`{ v, type, payload }`), painéis novos na UI
  e tracks identificados por propósito (`camera`/`screen`/`mic`). Camadas:
  `signaling ↔ connection ↔ channels ↔ media ↔ ui`.

## Definição de "concluído"

1. `npm run build` e `npm run typecheck` sem erros.
2. `npm run test:api` (criação de sala, senha errada/certa, rejeição do 3º participante, expiração) verde contra o Turso real.
3. `npm run test:handshake` — dois peers simulados trocam offer/answer pelas rotas reais.
4. Deploy em `meet2026.vercel.app` + `npm run smoke:prod` verde (emenda 2).
5. Checklist manual (browser/câmera/4G↔wifi/SAS) entregue ao humano — execução é dele.

## Decisões tomadas durante a execução

- Inatividade da sala: expira após **15 min** sem nenhuma requisição autorizada; vida máxima 24 h.
- Sessão do operador: 12 h.
- SAS exibido como **6 dígitos** (ex.: `123 456`) — neutro de idioma, fácil de ler em voz alta.
- Copy pública em linguagem leiga (sem jargão técnico); a nota de privacidade explica o essencial em português claro.
- `.env` local usa `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` (+ `TURN_*` opcionais).
