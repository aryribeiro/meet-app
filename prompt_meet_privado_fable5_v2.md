# Prompt — Construção do "Meet App!" (v2, otimizado para Claude Fable 5)

## Ambiente de execução

Este prompt será executado no **Claude Code**, com o repositório local `meet-app` aberto como diretório de trabalho e um arquivo `.env` presente na raiz contendo as credenciais do Turso (`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`) e, opcionalmente, credenciais TURN (`TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL`). Leia o `.env` quando necessário, mas **nunca imprima valores de credenciais** em nenhuma saída.

## Papel

Você é um engenheiro de software sênior especializado em WebRTC, Next.js/TypeScript, arquiteturas serverless na Vercel e privacidade por design. Entregue código de produção — não pseudocódigo nem exemplos incompletos.

## Objetivo

Construir um web app análogo ao Google Meet para chamadas de áudio e vídeo (ou só áudio) entre **duas pessoas**, com deploy na Vercel.

**Requisito central — modelo de ameaça honesto:** o conteúdo da mídia (áudio/vídeo/dados) deve ser criptografado ponta a ponta, de forma que o operador do serviço **não consiga interceptá-lo nem por ataque ativo à sinalização** (MITM). Como a sinalização passa pelo servidor do operador, isso exige **verificação out-of-band**: o app deve derivar um código curto de autenticação (SAS) dos fingerprints DTLS dos dois peers e exibi-lo aos participantes, que o comparam em voz alta. Códigos iguais = canal autenticado; diferentes = possível MITM. Sem essa verificação implementada, o app não pode alegar privacidade contra o operador — e a nota de privacidade (entregável 5) deve refletir exatamente isso.

## Decisões de arquitetura já fechadas (não renegocie sem justificar tecnicamente)

- **Mídia:** WebRTC mesh 1:1 (P2P direto, sem SFU/MCU). SRTP/DTLS nativo do navegador.
- **Sinalização:** sem WebSocket, sem Socket.io/Pusher/Ably/Redis. "Caixa de correio" no **Turso (libSQL/SQLite)**: cada peer escreve mensagens (offer/answer/ICE candidates) numa tabela associada à sala; o outro faz polling HTTP curto (~1s) via Vercel Functions stateless. Regras do polling:
  - **Para quando a conexão P2P estabelece** (estado `connected`); reabre apenas para renegociação/ICE restart.
  - **Timeout agressivo:** se a sala não completar o handshake em N minutos (padrão: 5) ou ficar sem atividade, o cliente para de fazer polling e a sala expira — nunca deixar polling infinito consumindo o free tier da Vercel.
- **Glare e resiliência:** implementar o padrão **perfect negotiation** (polite/impolite peer) — com polling de ~1s, offers simultâneas são prováveis. Implementar **ICE restart** automático em falha de conexão.
- **NAT traversal:** STUN público gratuito por padrão. Modo **relay-only** (esconder o IP de cada peer do outro) disponível **apenas se** credenciais TURN estiverem configuradas nas env vars — não existe TURN gratuito confiável, então: sem credenciais, o toggle de relay-only não aparece na UI. Documentar como configurar um TURN próprio (ex.: coturn) no README.
- **Orçamento:** zero por padrão. Vercel Hobby, Turso free tier, STUN gratuito. TURN é o único opcional pago, por conta do usuário.
- **Contas/login:** nenhum. Entrada via link/código de sala único e efêmero.
- **Retenção e limpeza (lazy):** linhas de sinalização apagadas assim que consumidas; salas expiradas são limpas **de forma lazy nas próprias requisições de leitura/escrita** (Vercel Hobby não tem cron confiável de alta frequência). Nenhum áudio/vídeo tocado ou armazenado em servidor. Sem analytics ou tracking de terceiros.
- **Foto de perfil/fallback:** trafega exclusivamente pelo **RTCDataChannel** (também DTLS ponta a ponta). Nunca sobe para o servidor.
- **Início de uma reunião:** a reunião só poderá ser iniciada pelo administrador do web app, mediante senha advinda do banco Turso. A senha padrão será admin123 que deverá estar codificada em base64 no código, para depois o administrador mudar na primeira utilização, no painel próprio dele.

## Modularidade e extensibilidade (roadmap futuro)

O app deve nascer preparado para três evoluções já planejadas — **sem implementá-las agora**: (a) chat de texto entre os dois participantes, (b) envio de imagens e arquivos, (c) apresentação de tela. Todas as três preservam a filosofia do produto: trafegam P2P (DataChannel/track WebRTC), nunca pelo servidor. Para viabilizá-las sem retrabalho, a arquitetura deve seguir:

- **Protocolo de mensagens no DataChannel:** todo tráfego do DataChannel (hoje: perfil/foto de fallback) usa um envelope tipado e versionado — ex.: `{ v: 1, type: 'profile' | 'chat' | 'file-meta' | 'file-chunk' | ..., payload }` — com um registro de handlers por `type` (`registerHandler('chat', fn)`). Adicionar chat ou arquivos no futuro = registrar um handler novo, sem tocar no transporte. Tipos desconhecidos são ignorados com log, nunca quebram a conexão (compatibilidade entre versões dos dois peers).
- **Transferência de arquivos preparada:** a foto de fallback já deve ser enviada em **chunks com backpressure** (`bufferedAmountLowThreshold`), como um mini-protocolo `file-meta` + `file-chunk` + `file-end` — o mesmo mecanismo servirá para imagens/arquivos genéricos depois. Não hardcodar "foto" no transporte; o transporte transfere blobs, a camada de cima decide que o blob é a foto de perfil.
- **Abstração de tracks:** o `useWebRTCCall` não deve assumir "1 track de vídeo + 1 de áudio por peer". Modele os tracks remotos como uma coleção identificada por propósito (`camera` | `screen` | `mic`), usando o campo apropriado (ex.: `transceiver`/stream ids sinalizados via DataChannel) para o peer remoto saber o que é o quê. Adicionar screen share depois = `getDisplayMedia()` + `addTrack` + renegociação — que o perfect negotiation já cobre — sem refatorar o hook.
- **UI composicional:** a tela de chamada é composta por painéis/slots independentes (grid de mídia, barra de controles, painel lateral). Chat e lista de arquivos futuros entram como novos painéis laterais, não como reescrita da tela.
- **Separação de camadas explícita:** `signaling` (Turso/polling) ↔ `connection` (RTCPeerConnection/negociação) ↔ `channels` (protocolo do DataChannel) ↔ `media` (tracks/qualidade) ↔ `ui`. Nenhuma feature futura deve exigir mudança na camada de sinalização.
- **Não implementar as features futuras agora** — apenas os pontos de extensão acima. Nada de UI de chat escondida ou código morto; o custo da extensibilidade deve ser estrutura, não features pela metade.

## Requisitos funcionais

1. **Nome do app:** "Meet App!".
2. **Capacidade:** estritamente 2 pessoas — admin (cria) e convidado. A terceira tentativa de conexão é rejeitada. A ocupação da segunda vaga deve ser **atômica no banco** (ex.: `UPDATE ... WHERE participants < 2` verificando linhas afetadas) — nunca ler-checar-escrever, para não haver race condition com polling.
3. **Link efêmero:** o admin gera link único; expira quando a reunião termina (encerramento por qualquer um) ou por timeout de inatividade.
4. **Senha opcional:** definida na criação da sala. Se definida, o convidado precisa acertá-la para entrar. Armazenar como hash com salt por sala (PBKDF2 via Web Crypto — disponível no runtime da Vercel; não usar dependência nativa como argon2/bcrypt que quebra em serverless). O acesso às rotas de sinalização de uma sala deve exigir um **token de sala** emitido só após validação de entrada — a senha protege a sinalização, não só a UI.
5. **Verificação SAS (novo, obrigatório):** após a conexão estabelecer, exibir aos dois participantes um código curto (palavras ou dígitos) derivado dos fingerprints DTLS locais e remotos, com a instrução de uma frase: "Leiam este código em voz alta um para o outro. Se for igual, a chamada está segura." UI simples, dispensável após confirmação.
6. **Modos de mídia:** cada participante entra/permanece só com mic, ou câmera + mic, e alterna livremente antes/durante a chamada, independente do outro.
7. **Vídeo:** 720p por padrão. Se a conexão de um participante degradar, substituir o vídeo dele pela foto de fallback (item 9), mantendo o áudio — sem derrubar a chamada. Detectar degradação via **`getStats()`** (packet loss, RTT, jitter) em intervalo regular.
8. **Áudio adaptativo:** não construir um sistema HD/não-HD manual — o Opus adapta bitrate nativamente. Implementar como: configurar Opus adequadamente no SDP, monitorar via `getStats()` e ajustar `RTCRtpSender.setParameters()` (maxBitrate) nos dois sentidos conforme a rede varia. Documentar essa decisão em comentário.
9. **Perfil pré-reunião:** nome/nick + foto (fallback do item 7), trafegando só via DataChannel.
10. **Controles na chamada:** mute do próprio microfone e mute da saída de áudio (som recebido), independentes.
11. **Git:** commite o progresso no branch `main` do repo local com mensagens convencionais. **Não use `git push --force`** por padrão; se um push for rejeitado, pare e reporte o estado do remoto antes de qualquer ação destrutiva.
12. **Deploy:** a URL de produção é `https://meet2026.vercel.app`. O deploy atual é um protótipo obsoleto (já removido do repo local) e será substituído pelo novo build — nenhuma migração ou preservação é necessária.

## Entregáveis, nesta ordem

1. **Plano de execução** (novo, antes de qualquer código): em até 20 linhas, a ordem de construção e o que valida cada etapa. A ordem de construção segue a ordem de validação — **handshake de sinalização primeiro, mídia depois, features por último** — não a ordem deste documento.
2. **Estrutura de pastas** do projeto Next.js (App Router, TypeScript), refletindo as camadas `signaling` / `connection` / `channels` / `media` / `ui` e indicando onde as features futuras (chat, arquivos, screen share) se encaixariam.
3. **Schema SQL** das tabelas no Turso — sala (hash+salt de senha opcional, expiração, contagem atômica de participantes, token de sala) e sinalização — com justificativa de cada campo.
4. **Código completo:**
   - API routes: criar sala, validar entrada do convidado (senha + vaga atômica + emissão de token), postar sinalização, polling, encerrar/expirar (com limpeza lazy).
   - Hook `useWebRTCCall`: getUserMedia, RTCPeerConnection com perfect negotiation, troca de offer/answer/ICE via API routes, ICE restart, monitoramento via getStats (fallback de vídeo + adaptação de áudio), derivação do SAS, parada do polling pós-conexão, cleanup — com tracks modelados por propósito e o DataChannel exposto via o protocolo tipado/registro de handlers (seção de modularidade).
   - UI: perfil pré-reunião, pré-chamada (preview, permissões, senha se aplicável), chamada (vídeos com fallback de foto, SAS, mutes, câmera on/off, relay-only quando disponível, encerrar), estado "aguardando participante".
5. **Instruções de deploy:** Turso CLI, env vars na Vercel, deploy.
6. **Nota de privacidade honesta:** o que está protegido (conteúdo, com verificação SAS feita), o que não está (IPs visíveis entre peers sem TURN; metadados de horário/duração visíveis ao operador), sem overselling.

## Regras de execução

- TypeScript estrito, sem `any`.
- Comente no código toda decisão que afeta segurança/privacidade.
- Nenhuma dependência de sinalização de terceiros nem serviço pago por padrão.
- **Ambiguidade:** se algo for genuinamente ambíguo (duração da sala, textos de UI), tome a decisão mais razoável, registre-a num bloco "Decisões tomadas" no final, e prossiga. Só pergunte se a ambiguidade puder causar retrabalho estrutural.
- **Escalonamento (novo):** se descobrir que um requisito é tecnicamente impossível ou conflita com outro (ex.: limitação nova da Vercel), **não simule uma solução** — pare, explique o conflito e proponha alternativas.
- **Definição de "concluído" (executável):**
  1. `npm run build` e `tsc --noEmit` passam sem erros.
  2. Testes automatizados das API routes (criação de sala, senha errada/certa, rejeição do 3º participante, expiração) passam localmente contra o Turso.
  3. Handshake de sinalização validado por script/teste que simula dois peers trocando offer/answer via as rotas reais.
  4. **Checklist manual entregue ao humano** para o que exige browser/câmera/duas redes: chamada real entre 4G e wifi em produção, comparação visual dos códigos SAS nos dois aparelhos, teste do fallback de vídeo e dos mutes. Você prepara e documenta esse checklist; a execução é minha.
- Ao final, salve este prompt como `PROMPT.md` na raiz do repo, para que as decisões de arquitetura sobrevivam à conversa.
