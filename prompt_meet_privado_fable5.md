# Prompt — Construção do "Meet App!"

## Papel

Você é um engenheiro de software sênior full-stack, QA sênior, Designer UI/UX Sênior, Designer Thinker Sênior, especialista DevSecOps, especialista em WebRTC, Next.js/TypeScript, arquiteturas serverless na Vercel e privacidade por design (privacy-by-design). Seu trabalho é entregar código de produção, não pseudocódigo nem exemplos incompletos.

## Objetivo

Construir um web app próprio, análogo ao Google Meet, para chamadas de áudio e vídeo (ou só áudio) entre **duas pessoas**, com deploy na Vercel. O requisito não-negociável do projeto é **privacidade real**: ninguém — nem o operador do serviço (eu) — deve conseguir interceptar o conteúdo da chamada.

## Decisões de arquitetura já fechadas (não renegocie sem justificar tecnicamente)

- **Mídia (áudio/vídeo):** WebRTC em modo mesh 1:1 (P2P direto, sem SFU/MCU). A mídia trafega via SRTP/DTLS nativo do navegador — criptografia ponta a ponta automática, sem servidor no meio decodificando.
- **Sinalização:** SEM WebSocket. Implementar como "caixa de correio" no **Turso (libSQL/SQLite)**: cada peer escreve mensagens (offer/answer/ICE candidates) numa tabela associada ao ID da sala; o outro peer faz *polling* HTTP curto (~1s) via Vercel Functions stateless. Escrito do zero — sem Socket.io, Pusher, Ably ou Redis.
- **NAT traversal:** STUN público gratuito por padrão. Suportar um modo opcional "relay-only" via TURN, para esconder o IP de cada peer do outro (usuário escolhe ativar quando a privacidade contra o outro participante importa mais que a latência).
- **Orçamento:** zero. Usar apenas free tiers: Vercel Hobby, Turso free tier, STUN gratuito. Nada de serviços pagos por padrão.
- **Contas/login:** nenhum. Entrada na chamada via link/código de sala único, efêmero.
- **Retenção de dados:** as linhas de sinalização (SDP/ICE) devem ser apagadas do Turso assim que consumidas ou quando a sala expira. Nenhum áudio/vídeo é armazenado em servidor, em nenhum momento. Sem analytics ou tracking de terceiros.

## Requisitos funcionais específicos

1. **Nome do app:** "Meet App!".
2. **Capacidade:** estritamente duas pessoas por sala — admin (quem cria a reunião) e convidado. Ninguém mais pode entrar; a terceira tentativa de conexão deve ser rejeitada.
3. **Criação/expiração do link:** o admin gera um link único de convite. O link expira automaticamente quando a reunião termina (encerramento por qualquer um dos dois, ou timeout de inatividade da sala).
4. **Senha opcional:** o admin pode, ao criar a sala, definir uma senha. Se definida, o convidado é obrigado a informá-la corretamente para entrar.
5. **Modos de mídia:** cada participante pode entrar/permanecer só com microfone, ou com câmera + microfone juntos, e pode ativar/desativar câmera e microfone livremente antes ou durante a reunião, independente do que o outro participante estiver usando.
6. **Vídeo — qualidade e fallback:** vídeo em 720p por padrão. Se a conexão de um dos participantes degradar, substituir o vídeo dele por uma foto estática (a do fallback definido no passo 8) mantendo apenas o áudio transmitindo — sem cortar a chamada.
7. **Áudio — qualidade adaptativa:** áudio em qualidade HD por padrão, alternando automaticamente para não-HD quando a conexão de algum participante piorar, e voltando para HD quando a conexão melhorar novamente (adaptação contínua, nos dois sentidos).
8. **Perfil pré-reunião:** antes de entrar na chamada, cada participante pode definir nome/nick e uma foto — essa foto é o que aparece como fallback quando o vídeo cai (item 6).
9. **Controles durante a reunião:** cada participante pode mutar o próprio microfone e também mutar a saída de áudio (o som que recebe do outro), independentemente um do outro.
10. **Repositório público "meet-app" já criado no github:** use --force se preciso na hora do push.
11. **Deploy antigo de um protótipo está implantado no vercel:** a url https://meet2026.vercel.app será usada e o que está no vercel deverá ser descartado sem pensar duas vezes, por se tratar de um teste. O que está lá é um protótipo obsoleto e já foi apagado do repo e do vscode, localmente.

## Entregáveis esperados, nesta ordem

1. **Estrutura de pastas** do projeto Next.js (App Router, TypeScript).
2. **Schema SQL** das tabelas no Turso — sinalização, sala (com hash de senha opcional, timestamp de expiração, limite de 2 participantes) — com justificativa de cada campo.
3. **Código completo**:
   - API routes (Vercel Functions) para: criar sala (admin, com senha opcional), validar entrada do convidado (senha + limite de 2 pessoas), postar mensagem de sinalização, polling de mensagens novas, encerrar/expirar sala.
   - Hook React de WebRTC (`useWebRTCCall` ou similar): getUserMedia, RTCPeerConnection, troca de offer/answer/ICE via as API routes acima, monitoramento de qualidade de conexão (para o fallback de vídeo→foto e a adaptação de áudio HD/não-HD), cleanup de conexão.
   - Componentes de UI: tela de perfil pré-reunião (nome/nick + foto de fallback), tela de pré-chamada (preview de câmera/mic, permissões, campo de senha se aplicável), tela de chamada (vídeo local + remoto com fallback de foto, mute de microfone, mute de saída de áudio, câmera on/off, alternar modo relay-only, encerrar), estado de "aguardando o outro participante".
4. **Instruções de deploy passo a passo**: criação do banco Turso (CLI), variáveis de ambiente na Vercel, deploy.
5. **Nota de privacidade honesta**: o que está de fato protegido (conteúdo da mídia) e o que não está por padrão (IP visível entre peers, a menos que relay-only esteja ativo) — sem overselling.

## Regras de execução

- TypeScript estrito, sem `any`.
- Comentar no código toda decisão que afeta segurança/privacidade (por que ali, por que assim).
- Não introduzir dependências de sinalização de terceiros nem serviços pagos.
- Se algo for genuinamente ambíguo (ex. limite de duração da sala, texto de UI), tome a decisão mais razoável e prossiga — só pergunte se a ambiguidade puder levar a retrabalho estrutural.
- Entregue o código pronto para rodar, não fragmentos soltos.
- Convoque o conselho para um brainstorm sobre esse projeto para um planejamento, antes de iniciar, e caso decida que o mesmo dará certo, prossiga com a construção e convoque agentes para atuar nas especializações citadas nesse documento, atuando como sêniores.
- Somente dê algo como concluído, após testar tudo localmente e depois, em produção no vercel, smoke test feito com sucesso.
- Obs.: Sobre o deploy no Vercel especificamente: desde junho/2026 o Vercel tem suporte nativo a WebSocket, mas com uma pegadinha real para esse caso: a conexão fica "pinada" numa única instância de Function, e não há garantia de que reconexões caiam na mesma instância nem broadcast nativo entre instâncias.
- Ao iniciar a construção, leia as credenciais Turso no .env mas nunca imprima elas no chat, por segurança.
