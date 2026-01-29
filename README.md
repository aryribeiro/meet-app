# 📹 Meet! - Aplicativo de Reuniões de Vídeo P2P

Aplicativo web para reuniões de vídeo e áudio entre duas pessoas usando Flask e Daily.co.

## 🚀 Características

- ✅ Reuniões de vídeo e áudio em tempo real
- ✅ Máximo de 2 participantes por reunião
- ✅ Gratuito até 10 participantes (Daily.co)
- ✅ Funciona perfeitamente em produção (Vercel)
- ✅ Suporte completo para desktop e mobile
- ✅ Autenticação com senha para administradores
- ✅ Código único de reunião (8 caracteres)
- ✅ Interface limpa e intuitiva em português
- ✅ Powered by Daily.co

## 📋 Pré-requisitos

- Python 3.8 ou superior
- Conta no Daily.co (gratuita)
- Navegador moderno (Chrome, Firefox, Safari, Edge)

## 🔧 Instalação Local

### 1. Clone o projeto

```bash
git clone https://github.com/aryribeiro/meet-app.git
cd meet-app
```

### 2. Configure Daily.co

1. Crie conta em https://dashboard.daily.co/signup
2. Adicione cartão (não cobra se ficar em 2 pessoas)
3. Vá em "Developers" → "API Keys"
4. Copie sua API key
5. Cole no arquivo `.env`:

```
DAILY_API_KEY=sua_api_key_aqui
```

### 3. Instale as dependências

```bash
pip install -r requirements.txt
```

### 4. Execute o aplicativo

```bash
python app.py
```

O aplicativo abrirá em `http://localhost:5000`

## ☁️ Deploy no Vercel

### 1. Configure variáveis de ambiente

No dashboard do Vercel, adicione:
- `DAILY_API_KEY` = sua API key do Daily.co

### 2. Deploy via GitHub

1. Faça push do código para GitHub (sem o `.env`)
2. Acesse [vercel.com](https://vercel.com)
3. Clique em "New Project"
4. Importe seu repositório
5. Adicione a variável de ambiente `DAILY_API_KEY`
6. Clique em "Deploy"

**✅ Funciona perfeitamente em produção!**

## 🔐 Credenciais Padrão

**Senha de Administrador:** `admin123`

⚠️ **IMPORTANTE:** Altere a senha no código (`app.py` linha 48) antes de fazer deploy em produção!

## 📖 Como Usar

### Para o Administrador:

1. Acesse o aplicativo
2. Digite a senha: `admin123`
3. Clique em **"Autenticar"**
4. Clique em **"Iniciar Reunião"**
5. Copie o **código de 8 caracteres** gerado
6. Compartilhe o código com o convidado
7. A sala Daily.co abrirá automaticamente
8. Clique em **"Join meeting"**

### Para o Convidado:

1. Acesse o aplicativo
2. Digite o **código de 8 caracteres** recebido
3. Clique em **"Entrar"**
4. A sala Daily.co abrirá automaticamente
5. Clique em **"Join meeting"**

### Durante a Reunião:

- **🎥 Câmera:** Controle dentro da interface do Daily.co
- **🎤 Microfone:** Controle dentro da interface do Daily.co
- **💬 Chat:** Disponível no Daily.co
- **🖥️ Compartilhar Tela:** Disponível no Daily.co
- **🚪 Encerrar Reunião:** Clique no botão vermelho

## 🛠️ Estrutura do Projeto

```
meet-app/
│
├── app.py               # Backend Flask
├── templates/
│   └── index.html       # Frontend
├── requirements.txt     # Dependências Python
├── .env                # API key (não commitar)
├── .gitignore          # Arquivos ignorados
├── vercel.json         # Configuração Vercel
└── README.md           # Documentação
```

## ⚙️ Tecnologias

- **Flask 3.0** - Framework web Python
- **Daily.co** - Plataforma de vídeo conferência
- **Vercel** - Hospedagem serverless
- **Python 3.8+** - Linguagem de programação

## 🔒 Segurança

- Códigos de reunião são únicos e não repetíveis
- Códigos expiram quando a reunião termina
- Salas expiram em 1 hora automaticamente
- Máximo de 2 participantes por sala
- API key armazenada em variável de ambiente

## 🐛 Troubleshooting

### Erro "API key não configurada"

- Verifique se criou o arquivo `.env`
- Confirme que colocou a API key correta
- No Vercel, adicione a variável de ambiente

### Câmera/Microfone não funcionam

- Verifique permissões do navegador
- Clique em "Join meeting" dentro da interface Daily.co
- Certifique-se de estar usando HTTPS (em produção)

### Código inválido

- Verifique se digitou corretamente (8 caracteres)
- Código pode ter expirado (administrador saiu)
- Peça um novo código ao administrador

## 📝 Limitações

- Máximo de 2 participantes por reunião
- Salas expiram em 1 hora
- Códigos armazenados em memória (não persistem entre deploys)
- Requer cartão no Daily.co (mas não cobra se ficar em 2 pessoas)

## 💰 Custos

Daily.co é **gratuito** até:
- 10 participantes simultâneos
- 1000 minutos/mês

Para 2 pessoas, você nunca pagará nada! 🎉

## 📄 Licença

Este projeto é fornecido como está, para fins educacionais e de demonstração.

## 👨💻 Autor

**Ary Ribeiro**
- GitHub: [@aryribeiro](https://github.com/aryribeiro)
- Email: aryribeiro@gmail.com

## 💬 Suporte

Para problemas ou dúvidas:
1. Verifique a seção de Troubleshooting
2. Consulte a documentação do [Flask](https://flask.palletsprojects.com)
3. Consulte a documentação do [Daily.co](https://docs.daily.co)
4. Consulte a documentação do [Vercel](https://vercel.com/docs)

## 🙏 Agradecimentos

- [Flask](https://flask.palletsprojects.com) - Framework web Python
- [Daily.co](https://daily.co) - Plataforma de vídeo conferência
- [Vercel](https://vercel.com) - Hospedagem serverless

---

**Desenvolvido com ❤️ usando Flask e Daily.co**
