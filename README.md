# 📹 Meet! - Aplicativo de Reuniões de Vídeo P2P

Aplicativo web simples para reuniões de vídeo e áudio entre duas pessoas usando Streamlit e WebRTC.

## 🚀 Características

- ✅ Reuniões peer-to-peer entre 2 pessoas
- ✅ Vídeo e áudio em tempo real
- ✅ Autenticação com senha para administradores
- ✅ Código único de reunião (8 caracteres)
- ✅ Escolha de câmera e microfone antes de entrar
- ✅ Funciona apenas com áudio (sem câmera)
- ✅ Alterar senha de administrador durante reunião
- ✅ Interface limpa e intuitiva em português
- ✅ Suporte para desktop e mobile (HTTPS necessário)

## 📋 Pré-requisitos

- Python 3.8 ou superior
- Navegador moderno (Chrome, Firefox, Safari, Edge)
- Conexão com internet

## 🔧 Instalação Local

### 1. Clone ou baixe o projeto

```bash
git clone https://github.com/aryribeiro/meet-app.git
cd meet-app
```

### 2. Crie um ambiente virtual (recomendado)

```bash
python -m venv venv

# Windows
venv\Scripts\activate

# Linux/Mac
source venv/bin/activate
```

### 3. Instale as dependências

```bash
pip install -r requirements.txt
```

### 4. Execute o aplicativo

```bash
streamlit run app.py
```

O aplicativo abrirá automaticamente no navegador em `http://localhost:8501`

## ☁️ Deploy no Streamlit Cloud

### 1. Prepare o repositório

1. Crie um repositório no GitHub
2. Faça upload dos arquivos:
   - `app.py`
   - `requirements.txt`
   - `.streamlit/config.toml`
   - `README.md`

### 2. Deploy no Streamlit Cloud

1. Acesse [share.streamlit.io](https://share.streamlit.io)
2. Faça login com sua conta GitHub
3. Clique em "New app"
4. Selecione:
   - Repository: seu repositório
   - Branch: main
   - Main file path: `app.py`
5. Clique em "Deploy"

### 3. Aguarde o deploy

O Streamlit Cloud irá:
- Instalar as dependências
- Iniciar o aplicativo
- Fornecer uma URL pública HTTPS

**⚠️ Nota Importante:**

O streamlit-webrtc funciona melhor com HTTPS. Para produção real com muitos usuários, considere:
- Usar serviços TURN pagos (Twilio, Xirsys)
- Alternativas como Agora.io ou Daily.co

## 🔐 Credenciais Padrão

**Senha de Administrador:** `admin123`

⚠️ **IMPORTANTE:** Altere a senha após o primeiro acesso usando a opção "Alterar Senha" no painel do administrador!

## 📖 Como Usar

### Para o Administrador:

1. Acesse o aplicativo
2. Clique em **"Iniciar Reunião"**
3. Digite a senha: `admin123`
4. Escolha se quer ativar **câmera** e **microfone**
5. Clique em **"Iniciar Reunião"**
6. Copie o **código de 8 caracteres** gerado
7. Compartilhe o código com o convidado
8. Clique em **"Iniciar"** no seu vídeo
9. Permita acesso à câmera e microfone quando solicitado
10. Aguarde o convidado conectar

### Para o Convidado:

1. Acesse o aplicativo
2. Clique em **"Entrar em Reunião"**
3. Digite o **código de 8 caracteres** recebido
4. Escolha se quer ativar **câmera** e **microfone**
5. Clique em **"Entrar"**
6. Clique em **"Iniciar"** no seu vídeo
7. Permita acesso à câmera e microfone quando solicitado
8. Clique em **"Iniciar"** no vídeo do participante remoto
9. A conexão será estabelecida

### Durante a Reunião:

- **🎥 Status da Câmera:** Exibido abaixo do seu vídeo
- **🎤 Status do Microfone:** Exibido abaixo do seu vídeo
- **🔐 Alterar Senha:** Administrador pode alterar senha (expander)
- **🚪 Encerrar Reunião:** Clique para sair e voltar à tela inicial

## 🛠️ Estrutura do Projeto

```
meet-app/
│
├── .streamlit/
│   └── config.toml          # Configurações de tema
│
├── app.py                   # Aplicativo principal
├── requirements.txt         # Dependências Python
└── README.md               # Documentação
```

## ⚙️ Configurações Técnicas

### WebRTC Configuration

O aplicativo usa servidores STUN públicos do Google:
- `stun:stun.l.google.com:19302`
- `stun:stun1.l.google.com:19302`

### Armazenamento Compartilhado

Reuniões ativas são armazenadas em `active_meetings.json` para permitir que diferentes sessões (navegadores) compartilhem códigos de reunião.

### Session State

Gerenciamento de estado usando `st.session_state`:
- `authenticated`: Status de autenticação
- `meeting_code`: Código da reunião atual
- `is_host`: Identifica se é administrador
- `in_meeting`: Status da reunião
- `video_enabled`: Câmera ativada
- `audio_enabled`: Microfone ativado
- `admin_password`: Senha do administrador (padrão: admin123)

## 🔒 Segurança

- Códigos de reunião são únicos e não repetíveis
- Códigos expiram quando a reunião termina
- Conexão P2P direta (dados não passam pelo servidor)
- Senha de administrador pode ser alterada durante a reunião

## 🐛 Troubleshooting

### Câmera/Microfone não funcionam

- Verifique permissões do navegador
- Certifique-se de que nenhum outro app está usando a câmera
- Teste em navegador diferente
- Em mobile, use HTTPS (deploy no Streamlit Cloud)

### Não consegue conectar

- Verifique sua conexão com internet
- Firewall pode estar bloqueando WebRTC
- Tente usar VPN se estiver em rede corporativa
- Clique em "Iniciar" em ambos os vídeos (local e remoto)

### Código inválido

- Verifique se digitou corretamente (8 caracteres)
- Código pode ter expirado (administrador saiu)
- Peça um novo código ao administrador

### Erro "Component Error" em Mobile

- Use HTTPS (deploy no Streamlit Cloud)
- streamlit-webrtc tem limitações em mobile via HTTP
- Considere alternativas como Agora.io ou Daily.co para produção

## 📝 Limitações

- Apenas 2 participantes por reunião
- Sem gravação de reuniões
- Sem chat de texto
- Sem compartilhamento de tela
- Códigos armazenados em arquivo local (não persistem entre restarts)
- Pode requerer servidores TURN para algumas redes
- Suporte mobile limitado (requer HTTPS)

## 🚀 Melhorias Futuras

- [ ] Adicionar servidores TURN para melhor conectividade
- [ ] Implementar chat de texto
- [ ] Adicionar compartilhamento de tela
- [ ] Suporte para mais participantes
- [ ] Gravação de reuniões
- [ ] Persistência de dados em banco
- [ ] Melhor suporte mobile

## 📄 Licença

Este projeto é fornecido como está, para fins educacionais e de demonstração.

## 👨‍💻 Autor

**Ary Ribeiro**
- GitHub: [@aryribeiro](https://github.com/aryribeiro)
- Email: aryribeiro@gmail.com

## 💬 Suporte

Para problemas ou dúvidas:
1. Verifique a seção de Troubleshooting
2. Consulte a documentação do [Streamlit](https://docs.streamlit.io)
3. Verifique a documentação do [streamlit-webrtc](https://github.com/whitphx/streamlit-webrtc)

---

**Desenvolvido com ❤️ usando Streamlit**
