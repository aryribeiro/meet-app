# Meet App!

Chamadas de vídeo e voz entre **duas pessoas**, com privacidade real: a mídia vai
ponta a ponta (WebRTC P2P, SRTP/DTLS) e **nunca passa pelo servidor**. A sinalização é
uma caixa de correio efêmera no Turso (libSQL) consultada por polling HTTP — sem
WebSocket, sem serviços de terceiros, custo zero (Vercel Hobby + Turso free tier).

Produção: **https://meet2026.vercel.app**

## Arquitetura (resumo)

- `src/lib/server/` — Turso, PBKDF2 (Web Crypto), helpers HTTP. Limpeza lazy em toda rota.
- `src/app/api/` — criar sala (só o operador), entrar (senha + vaga atômica + token de
  sala), postar/poll de sinalização (protegidos por token), encerrar, ICE servers.
- `src/lib/client/` — camadas do contrato:
  - `signaling.ts` — polling com sono pós-conexão e timeout de handshake (5 min);
  - `useWebRTCCall.ts` — RTCPeerConnection com **perfect negotiation** + ICE restart;
  - `channels.ts` — protocolo tipado/versionado do DataChannel (chat/arquivos futuros = handler novo);
  - `media.ts` — 720p, teto de bitrate, monitor de qualidade **com histerese**;
  - `sas.ts` — código de segurança derivado dos fingerprints DTLS (ordem canônica).
- `src/app/` — home, `/sala/[id]` (pré-chamada → chamada), `/painel` (operador), `/privacidade`.
- Decisões de arquitetura completas: [PROMPT.md](PROMPT.md).

## Rodar localmente

```bash
npm install
# .env na raiz:
# TURSO_DATABASE_URL=libsql://<seu-banco>.turso.io
# TURSO_AUTH_TOKEN=<token>
npm run dev
```

Criação do banco (uma vez): `turso db create meet-app` e `turso db tokens create meet-app`.
O schema é criado automaticamente na primeira requisição; a senha inicial do painel
(`/painel`) é `admin123` e o painel **obriga a troca** no primeiro login.

## Testes

| Comando | O que prova |
|---|---|
| `npm run typecheck` | TypeScript estrito sem erros |
| `npm run test:api` | Rotas contra o Turso real: senha, vaga atômica, expiração, limpeza |
| `npm run test:handshake` | Dois peers simulados trocando offer/answer pelas rotas reais |
| `npm run test:e2e` | **Chamada P2P real** (2 browsers, mídia falsa): SAS igual nos dois lados, mute, encerramento |
| `npm run smoke:prod` | Smoke na URL de produção após o deploy |

## Deploy (Vercel)

1. Projeto Vercel ligado a este repositório (branch `main`).
2. Variáveis de ambiente no projeto: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`
   (e opcionalmente `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` — sem elas o modo
   "esconder meu endereço" não aparece na UI).
3. `git push` → deploy. Depois: `npm run smoke:prod`.

### TURN próprio (opcional)

Não existe TURN gratuito confiável. Para o modo relay-only, suba um
[coturn](https://github.com/coturn/coturn) num VPS barato:
`turnserver -a -u usuario:senha -r meet` e configure as `TURN_*` acima.

## Checklist manual (o que máquina não valida)

- [ ] Chamada real entre **4G e wi-fi** em produção (redes diferentes, NAT real).
- [ ] Comparar visualmente os **códigos de segurança** nos dois aparelhos (devem ser iguais).
- [ ] Derrubar a qualidade de um lado (ex.: limitar rede) e ver o vídeo virar **foto** mantendo o áudio; voltar a rede e ver o vídeo retornar sozinho.
- [ ] Mute de microfone e mute de saída de áudio, independentes, nos dois lados.
- [ ] Entrar só com voz e ligar a câmera no meio da chamada.
- [ ] Fechar a aba de um lado e confirmar que o outro vê o encerramento e o link morre.
- [ ] Trocar a senha do painel no primeiro login.

## Privacidade honesta

O conteúdo (áudio/vídeo/foto/nome) é ponta a ponta e verificável pelo código de
segurança lido em voz alta. O que o servidor vê: horário, duração aproximada e IPs
(metadados de sinalização) — nunca o conteúdo. Sem TURN, cada participante vê o IP do
outro. Detalhes em linguagem leiga: [/privacidade](https://meet2026.vercel.app/privacidade).
