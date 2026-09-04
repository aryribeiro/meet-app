# 🎥 Meet App!

**Conversa Privada a Dois** — chamadas de vídeo e voz entre **duas pessoas**, com
privacidade real: a mídia vai ponta a ponta (WebRTC P2P, SRTP/DTLS) e **nunca passa
pelo servidor**. A sinalização é uma caixa de correio efêmera no Turso (libSQL)
consultada por polling HTTP — sem WebSocket, sem serviços de sinalização de
terceiros, custo zero (Vercel Hobby + Turso free + TURN free tier).

Produção: **https://meet2026.vercel.app** · Validado em campo: PC cabeado (fibra
com CGNAT) ↔ celular 5G, com vídeo e áudio nos dois sentidos via relay.

## Funcionalidades

- **Salas 1:1 efêmeras** — criadas só pelo operador no painel `/painel`; link do
  anfitrião com token no fragmento (`#k=`, fora de logs) + link limpo do convidado;
  senha de sala opcional (PBKDF2); vaga única atômica (3º participante rejeitado);
  o link morre quando a conversa termina.
- **Código de segurança (SAS)** — 6 dígitos derivados dos fingerprints DTLS
  (ordem canônica), lidos em voz alta pelos dois lados: prova de que nem o
  operador do serviço consegue interceptar a chamada.
- **Perfil pré-reunião** — nome + foto opcional; trafegam **só pelo DataChannel**
  (nunca sobem ao servidor). A foto é o fallback do vídeo.
- **Palco 50/50 (estilo estúdio)** — dois tiles 16:9 do mesmo tamanho, lado a
  lado, centralizados sob o título (largura máxima 1280 px), nunca tela cheia:
  cada vídeo é exibido perto do tamanho em que foi capturado, sem esticar — o
  que gravações precisam. No celular em pé os tiles empilham.
- **Escada de qualidade por lado (4 degraus, automática)** — cada participante
  adapta só o que **envia**, pela perda que o outro reporta, pela largura de
  banda estimada (só quando o encoder declara limitação de rede) e pela
  limitação de processador do aparelho: 720p → SD (360p) → só voz HD com
  foto/inicial no lugar do vídeo → voz básica. Desce rápido (3 amostras), sobe
  devagar e um degrau por vez (5 amostras; dobra até 4× se ficar pisca-pisca);
  perda severa pula direto para "só voz". A voz é a última coisa a ceder. A
  escada decide a resolução e o navegador sacrifica quadros por segundo, não
  nitidez (`degradationPreference: maintain-resolution`).
- **Badges honestos** — o tile local mostra a resolução que o encoder está
  mandando **de fato** e por que está limitado ("· rede", "· aparelho"); o tile
  remoto mostra a resolução que está **chegando**, lida do próprio vídeo. O
  preview local segue sempre em 720p.
- **Fallback de foto nos dois sentidos** — câmera desligada (ou rede degradada) →
  o outro lado vê a foto; religou/melhorou → o vídeo volta sozinho (histerese).
- **Seleção de câmera e microfone** — na pré-chamada e durante a reunião (painel
  ⚙️), com troca a quente via `replaceTrack` sem derrubar a chamada.
- **Controles independentes** — mute do próprio mic, mute do som recebido,
  câmera on/off, encerrar.
- **Modo relay-only opcional** — "esconder meu endereço do outro participante"
  (aparece quando TURN está configurado).
- **Diagnóstico honesto de rede** — se CGNAT/VPN/firewall bloqueia a conexão e
  não há saída, tela clara com "Tentar de novo" (com reentrada do convidado na
  própria vaga) em vez de "reconectando" eterno.

## Arquitetura (camadas)

- `src/lib/server/` — Turso (cliente singleton), PBKDF2 via Web Crypto, limpeza
  lazy (por amostragem no caminho quente). Sem cron, sem estado em memória.
- `src/app/api/` — criar sala (operador), entrar (senha + vaga atômica + token de
  sala), sinalização protegida por token (GET de polling = **1 batch** ao banco),
  encerrar, ICE servers (TURN via env, multi-URL).
- `src/lib/client/`
  - `signaling.ts` — polling ~1 s que **dorme** pós-conexão; backoff exponencial
    (1s→8s) com jitter em falha; timeout de handshake de 5 min;
  - `useWebRTCCall.ts` — perfect negotiation (glare), ICE restart, watchdog de
    conexão (75 s), troca de dispositivos a quente;
  - `channels.ts` — protocolo tipado/versionado do DataChannel com registro de
    handlers e transferência em chunks com backpressure (chat/arquivos futuros =
    um handler novo, sem tocar no transporte);
  - `media.ts` — 720p, perfis de envio por degrau (`setParameters`: escala e
    teto de bitrate, sem renegociar) e monitor via `getStats()` a cada 2 s;
  - `src/lib/shared/ladder.ts` — a escada em si, máquina de estados pura
    (degrada: perda >8% ou RTT >400 ms ×3; severa: perda >20% pula para só voz;
    recupera: perda <2% e RTT <250 ms ×5, um degrau por vez);
  - `sas.ts` — derivação do código de segurança.
- `src/app/` — home, `/sala/[id]`, `/painel` (operador), `/privacidade`.

## Rodar localmente

```bash
npm install
# .env na raiz:
# TURSO_DATABASE_URL=libsql://<seu-banco>.turso.io
# TURSO_AUTH_TOKEN=<token>
# TURN_URL=turn:...,turn:...        (opcional; vírgula separa múltiplas URLs)
# TURN_USERNAME=...                 (opcional)
# TURN_CREDENTIAL=...               (opcional)
npm run dev
```

Banco (uma vez): `turso db create meet-app` + `turso db tokens create meet-app`.
O schema é criado na primeira requisição. Senha inicial do painel: `admin123` —
o painel **obriga a troca** no primeiro login.

## Testes

| Comando | O que prova |
|---|---|
| `npm run typecheck` | TypeScript estrito sem erros |
| `npm run test:api` | Rotas contra o Turso real: senha, vaga atômica, expiração, limpeza |
| `npm run test:ladder` | Escada de qualidade em Node puro: 37 checks (descida, subida um a um, salto severo, RTT de relay, largura de banda com gate do encoder, CPU do aparelho, anti pisca-pisca adaptativo) |
| `npm run test:handshake` | Dois peers simulados trocando offer/answer pelas rotas reais |
| `npm run test:e2e` | **Chamada real** (2 browsers, mídia fake): 22 checks — SAS igual nos dois lados, pixels de vídeo fluindo, fallback de foto por cor, troca de dispositivo, mutes, **cada degrau da escada forçado e provado no encoder, na resolução que chega no outro lado (720p → 360p) e no badge**, encerramento |
| `STRESS=N npm run test:e2e` | O mesmo + N ciclos completos da escada nos dois lados ao mesmo tempo, vídeo vivo ao fim de cada ciclo |
| `npm run qa:shots` | Capturas do palco (desktop e celular, espera, conectado, foto/inicial, badges) para QA visual |
| `RELAY=1 npm run test:e2e` | O mesmo, com **relay-only forçado** — prova o caminho TURN de ponta a ponta |
| `node scripts/turn-check.mjs` | O TURN configurado devolve relay candidates de verdade |
| `npm run smoke:prod` | Smoke na URL de produção após o deploy |

Os testes de chamada criam salas direto no banco — não dependem da senha do
operador (que deixa de ser `admin123` no primeiro uso).

## Deploy (Vercel)

1. Projeto Vercel ligado a este repositório (branch `main`) — `vercel.json` força
   o framework Next.js.
2. Env vars no projeto: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` e as `TURN_*`.
3. `git push` (ou `npx vercel --prod`) → depois `npm run smoke:prod`.

## TURN (necessário para 4G/5G/CGNAT e VPN)

Sem TURN, chamadas entre redes sem caminho direto **não conectam** — o app
detecta e explica. O relay só transporta tráfego **cifrado**: a criptografia
ponta a ponta e o SAS continuam valendo. Opções:

1. **Metered.ca** (em uso; free ~0,5 GB/mês — consumido só por chamadas que
   precisam do relay; P2P direto não gasta cota): credenciais do painel em
   [metered.ca/stun-turn](https://www.metered.ca/stun-turn), formato:
   ```
   TURN_URL=turn:global.relay.metered.ca:80,turn:global.relay.metered.ca:80?transport=tcp,turn:global.relay.metered.ca:443,turns:global.relay.metered.ca:443?transport=tcp
   TURN_USERNAME=<username>
   TURN_CREDENTIAL=<credential>
   ```
2. **coturn próprio** — ex.: Oracle Cloud Always Free (10 TB/mês) ou VPS:
   `turnserver -a -u usuario:senha -r meet`. Migração = trocar as 3 variáveis.

Valide sempre com `node scripts/turn-check.mjs` antes de subir para produção.

## Privacidade honesta

O conteúdo (áudio/vídeo/foto/nome) é ponta a ponta e verificável pelo código de
segurança lido em voz alta. O servidor vê apenas metadados de sinalização
(horário, duração aproximada, IPs) — nunca o conteúdo; um relay TURN vê apenas
pacotes cifrados. Sem relay-only ativo, cada participante vê o IP do outro.
Versão em linguagem leiga: [/privacidade](https://meet2026.vercel.app/privacidade).

## Roadmap (pontos de extensão já prontos na arquitetura)

Chat de texto, envio de imagens/arquivos e apresentação de tela — todos P2P via
DataChannel/tracks, entrando como handlers e painéis novos, sem retrabalho nas
camadas de sinalização e transporte.
