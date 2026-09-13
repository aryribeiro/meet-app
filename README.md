<img width="1319" height="593" alt="meetapp" src="https://github.com/user-attachments/assets/1c73d93a-eadc-425d-86ca-3b81f5b7fc3a" />

# 🎥 Meet App!

**Conversa Privada a Dois** — chamadas de vídeo e voz entre **duas pessoas**, com
privacidade real: a mídia vai ponta a ponta (WebRTC P2P, SRTP/DTLS) e **nunca passa
pelo servidor**. A sinalização é uma caixa de correio efêmera no Turso (libSQL)
consultada por polling HTTP — sem WebSocket, sem serviços de sinalização de
terceiros, custo zero (Vercel Hobby + Turso free + TURN free tier).

Produção: **https://meet2026.vercel.app** · Versão atual: **v1.9.2** (histórico em
[Releases](https://github.com/aryribeiro/meet-app/releases)).

Validado em campo pelo autor: PC cabeado (fibra com CGNAT) ↔ celular 5G via relay,
720p estável nos dois lados; chat, arquivos, apresentação de tela e tela cheia
testados entre PC e celular (setembro/2026).

Este é um web app de uso pessoal: o código é aberto para quem quiser implantar a
**própria** instância na própria conta (Vercel + Turso + um TURN).

## Funcionalidades

### A chamada

- **Salas 1:1 efêmeras** — criadas só pelo operador no painel `/painel`; link do
  anfitrião com token no fragmento (`#k=`, fora de logs) + link limpo do convidado;
  senha de sala opcional (PBKDF2); vaga única atômica (3º participante rejeitado);
  a sala expira com 15 min sem uso ou 24 h de vida, e o link morre quando a
  conversa termina.
- **Código de segurança (SAS)** — 6 dígitos derivados dos fingerprints DTLS
  (ordem canônica), lidos em voz alta pelos dois lados: prova de que nem o
  operador do serviço consegue interceptar a chamada.
- **Perfil pré-reunião** — nome + foto opcional; trafegam **só pelo DataChannel**
  (nunca sobem ao servidor). A foto é o fallback do vídeo.
- **Controles independentes** — mute do próprio mic, mute do som recebido,
  câmera on/off, encerrar. Ao encerrar (ou quando a sala expira ou a conexão
  falha), câmera e microfone **desligam na hora**, nos dois lados.
- **Seleção de câmera e microfone** — na pré-chamada e durante a reunião (painel
  ⚙️), com troca a quente via `replaceTrack` sem derrubar a chamada.
- **Sua imagem do jeito que o outro vê** — a prévia local não é espelhada por
  padrão (textos e logos saem certos na gravação de tela). Quem preferir se ver
  como num espelho liga "Espelhar minha imagem" na pré-chamada ou no ⚙️; a
  escolha fica lembrada no navegador. O vídeo enviado **nunca** é espelhado.

### O palco

- **Palco 50/50 (estilo estúdio)** — dois tiles 16:9 do mesmo tamanho, lado a
  lado, centralizados sob o título (largura máxima 1280 px), sem esticar o vídeo
  para a janela inteira: cada quadro é exibido perto do tamanho em que foi
  capturado, o que gravações precisam. No celular em pé os tiles empilham.
  Quadro em pé (celular na vertical) aparece inteiro, com barras laterais,
  nunca cortado.
- **Apresentar a tela** — botão 🖥️ (onde o navegador oferece captura de tela):
  a tela aparece grande para o outro lado e as duas câmeras encolhem para uma
  fileira embaixo, como no Google Meet; parar (pelo botão ou pelo próprio
  navegador) devolve o palco 50/50. A tela nunca perde resolução na escada de
  qualidade, só bitrate.
- **Tela cheia** — botão ⛶: só o palco, cobrindo a janela inteira, em PC,
  Android e iPhone (é um modo do próprio app; onde o navegador permite, entra
  também na tela cheia nativa). Com apresentação, a tela fica grande em cima e
  as câmeras embaixo. Chat e arquivos ficam de fora até sair por ESC, pelo X ou
  pelo navegador. Microfone, câmera e encerrar seguem à mão, sobrepostos: no PC
  somem após 3 s parados; no celular ficam escondidos até um toque no palco.

### Qualidade que se adapta e diz a verdade

- **Escada de qualidade por lado (4 degraus, automática)** — cada participante
  adapta só o que **envia**, pela perda que o outro reporta, pela largura de
  banda estimada (só quando o encoder declara limitação de rede) e pela
  limitação de processador do aparelho: 720p → SD (360p) → só voz HD com
  foto/inicial no lugar do vídeo → voz básica (16 kbps). Desce rápido (3
  amostras de 2 s), sobe devagar e um degrau por vez (5 amostras; dobra até 4×
  se ficar pisca-pisca); perda severa (> 20%) pula direto para "só voz"; latência
  alta sozinha, normal em relay, nunca pula. A voz é a última coisa a ceder. A
  escada decide a resolução e o navegador sacrifica quadros por segundo, não
  nitidez (`degradationPreference: maintain-resolution`).
- **Badges honestos** — o tile local mostra a resolução que o encoder está
  mandando **de fato** e por que está limitado ("· rede", "· aparelho"); o tile
  remoto mostra a resolução que está **chegando**, lida do próprio vídeo, pelo
  menor lado do quadro (celular em pé 720×1280 é 720p, não "1280p"). O preview
  local segue sempre em 720p.
- **Fallback de foto nos dois sentidos** — câmera desligada (ou rede degradada) →
  o outro lado vê a foto ou a inicial do nome; religou/melhorou → o vídeo volta
  sozinho (histerese).
- **Diagnóstico honesto de rede** — se CGNAT/VPN/firewall bloqueia a conexão e
  não há saída, tela clara com "Tentar de novo" (com reentrada do convidado na
  própria vaga) em vez de "reconectando" eterno. Faixas de aviso em linguagem
  leiga quando a escada desce.
- **Modo relay-only opcional** — "esconder meu endereço do outro participante"
  (aparece quando TURN está configurado).

### Mensagens e arquivos (P2P, efêmeros)

- **Mensagens de texto entre os dois** — painel abaixo do palco e dos controles,
  pelo mesmo canal direto ponta a ponta (nunca passa pelo servidor; a lista morre
  com a aba). Só texto: o que o outro lado manda é validado (forma, teto de 2000
  caracteres, caracteres de controle e invisíveis removidos) e mostrado como
  texto puro, sem HTML e sem links clicáveis; cada mensagem tem "copiar". Enter
  envia, Shift+Enter quebra linha. "Não enviada" quando o canal estava fechado.
  Botão 💬 esconde/mostra com contador de não lidas.
- **Arquivos dentro das mensagens** — 📎 envia pelo mesmo canal direto (P2P,
  nada no servidor, nada guardado), um arquivo por vez, com progresso real por
  bytes nos dois lados. Aceita imagens, PDF, documentos de escritório, áudio,
  vídeo e compactados até 20 MB; tudo o mais é recusado nos dois lados (com aviso
  no remetente, em silêncio no receptor). O tipo é decidido pela extensão do nome
  já sanitizado, nunca pelo tipo declarado. O arquivo só é baixado, nunca aberto
  inline. Quando a chamada passa por relay, o botão avisa que arquivos pesam na
  cota.

## Arquitetura (camadas)

- `src/lib/server/` — Turso (cliente singleton), PBKDF2 via Web Crypto, limpeza
  lazy (por amostragem no caminho quente). Sem cron, sem estado em memória.
- `src/app/api/` — criar sala (operador), entrar (senha + vaga atômica + token de
  sala), sinalização protegida por token (GET de polling = **1 batch** ao banco),
  encerrar, ICE servers (TURN via env, multi-URL).
- `src/lib/client/`
  - `signaling.ts` — polling ~1 s que **dorme** pós-conexão; backoff exponencial
    (1s→8s) com jitter em falha; timeout de handshake de 5 min; quem renegocia
    (tela, câmera tardia) acorda o polling do outro lado por mensagem no canal
    direto e os dois voltam a dormir 3 s depois de a negociação estabilizar;
  - `useWebRTCCall.ts` — perfect negotiation (glare), ICE restart, watchdog de
    conexão (75 s), troca de dispositivos a quente, apresentação de tela (track
    extra num fluxo próprio, anunciado por mensagem `screen` antes do track),
    chat e arquivos, desligamento dos tracks em qualquer fim de chamada;
  - `channels.ts` — protocolo tipado/versionado do DataChannel (`{v, type,
    payload}`) com registro de handlers, guarda de cabeçalho por propósito e
    transferência de blobs em chunks com backpressure, serializada (um blob por
    vez); tipos desconhecidos são ignorados (compatibilidade entre versões);
  - `media.ts` — captura 720p, perfis de envio por degrau (`setParameters`:
    escala e teto de bitrate, sem renegociar; perfil próprio para a tela) e
    monitor via `getStats()` a cada 2 s (perda, RTT, banda estimada, razão de
    limitação do encoder, resolução enviada, relay em uso);
  - `mirror.tsx` — preferência "espelhar minha imagem" (só a prévia local);
  - `sas.ts` — derivação do código de segurança.
- `src/lib/shared/` (puro, testável em Node)
  - `constants.ts` — todos os limiares, definidos antes do código;
  - `ladder.ts` — a escada de qualidade (degrada: perda > 8% ou RTT > 400 ms ×3;
    severa: perda > 20% pula para só voz; recupera: perda < 2% e RTT < 350 ms ×5,
    um degrau por vez; anti pisca-pisca adaptativo);
  - `chat.ts` — modelo e validação do webchat e dos arquivos (texto, nome,
    allowlist por extensão, teto);
  - `video.ts` — geometria do quadro (menor lado = "720p"; retrato).
- `src/components/` — `CallScreen` (palco, modo apresentação, tela cheia,
  controles), `ChatPanel`, `PreCall`, `DevicePicker`, `Avatar`, `JoinByCode`.
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
| `npm run test:handshake` | Dois peers simulados trocando offer/answer pelas rotas reais |
| `npm run test:ladder` | Escada de qualidade em Node puro: 37 checks (descida, subida um a um, salto severo, RTT de relay, largura de banda com gate do encoder, CPU do aparelho, anti pisca-pisca adaptativo) |
| `npm run test:chat` | Webchat e arquivos em Node puro: 34 checks (HTML vira texto, controle/bidi removidos por code point, teto de 2000, payload inválido descartado, nome de arquivo sanitizado, allowlist por extensão, teto de 20 MB) |
| `npm run test:video` | Geometria em Node puro: 6 checks (720×1280 é 720p; retrato detectado) |
| `npm run test:e2e` | **Chamada real** (2 browsers, mídia fake): 49 checks — SAS igual nos dois lados, pixels de vídeo fluindo, fallback de foto por cor, troca de dispositivo, mutes, cada degrau da escada forçado e provado no encoder, na resolução que chega no outro lado (720p → 360p) e no badge, webchat (ida, volta, URL sem link, HTML hostil vira texto, 5000→2000), arquivos (bytes iguais por sha-256, exe recusado nos dois lados, nome hostil sanitizado, guarda do receptor), apresentação de tela (pixels chegam nos dois sentidos, palco muda e volta, polling dorme de novo), celular em pé (rótulo 360p e quadro inteiro), tela cheia (cobre a janela, X e ESC devolvem, apresentação em cima, controles escondidos no celular), espelho (só na prévia, nunca no remoto), encerramento com câmera e microfone desligados |
| `STRESS=N npm run test:e2e` | O mesmo + N ciclos completos da escada nos dois lados ao mesmo tempo, vídeo vivo ao fim de cada ciclo |
| `RELAY=1 npm run test:e2e` | O mesmo, com **relay-only forçado** — prova o caminho TURN de ponta a ponta |
| `npm run qa:shots` | Capturas para QA visual: home, espera, conectado (desktop e celular), foto/inicial, badges da escada, chat com arquivo, apresentação, tela cheia |
| `node scripts/turn-check.mjs` | O TURN configurado devolve relay candidates de verdade |
| `npm run smoke:prod` | Smoke na URL de produção após o deploy |

Os testes de chamada criam salas direto no banco — não dependem da senha do
operador (que deixa de ser `admin123` no primeiro uso). Os `.ts` puros de
`src/lib/shared/` rodam no Node sem build (hook de resolução em `tests/_ts-hooks.mjs`).

### Ganchos de QA (`window.__meetQA`)

Durante uma chamada, a página expõe ganchos que os testes usam e que servem para
diagnosticar em campo pelo console do navegador: `forceTier(0–3 | null)`,
`getTier()`, `getReport()` (resolução enviada, razão de limitação, banda estimada,
perda, RTT, relay em uso), `getCapture()` (o que a câmera entrega),
`getEncodings()`, `shareTestScreen(cor)`, `useCanvasCamera(w, h, cor)`,
`sendRawFile(nome, bytes)`, `isPolling()`, `getLocalTrackStates()`. Todos agem só
no próprio lado — o mesmo que o usuário já pode fazer pela interface.

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
   precisam do relay; P2P direto não gasta cota; 720p nos dois sentidos gasta
   cerca de 19 MB por minuto): credenciais do painel em
   [metered.ca/stun-turn](https://www.metered.ca/stun-turn), formato:
   ```
   TURN_URL=turn:global.relay.metered.ca:80,turn:global.relay.metered.ca:80?transport=tcp,turn:global.relay.metered.ca:443,turns:global.relay.metered.ca:443?transport=tcp
   TURN_USERNAME=<username>
   TURN_CREDENTIAL=<credential>
   ```
2. **coturn próprio** — ex.: Oracle Cloud Always Free (10 TB/mês, região de
   São Paulo) ou VPS: `turnserver -a -u usuario:senha -r meet`. Migração =
   trocar as 3 variáveis.

Valide sempre com `node scripts/turn-check.mjs` antes de subir para produção.

## Privacidade honesta

O conteúdo (áudio/vídeo/foto/nome/mensagens/arquivos) é ponta a ponta e
verificável pelo código de segurança lido em voz alta. O servidor vê apenas
metadados de sinalização (horário, duração aproximada, IPs) — nunca o conteúdo;
um relay TURN vê apenas pacotes cifrados. Sem relay-only ativo, cada participante
vê o IP do outro. Nada é persistido: mensagens e arquivos morrem com a aba.
Versão em linguagem leiga: [/privacidade](https://meet2026.vercel.app/privacidade).

## Histórico e ideias anotadas

O roadmap de 04/09/2026 foi entregue por completo: chat de texto (v1.6.0),
apresentação de tela (v1.7.0), arquivos nas mensagens (v1.8.0), tela cheia e
cartão na home (v1.9.0), prévia sem espelho (v1.9.2). Os pontos de extensão
continuam prontos: novos recursos entram como handlers do canal direto, tracks
por propósito e painéis novos, sem retrabalho na sinalização.

Ideias anotadas, sem data: coturn próprio na Oracle Cloud (tira a cota do relay
e reduz a latência) e, depois dele, 1080p opcional só para PC em chamada direta,
com a escada 1080 → 720 → 360.
