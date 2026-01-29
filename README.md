# 📹 Meet! - Aplicativo de Reuniões de Vídeo P2P

Aplicativo web simples para reuniões de vídeo e áudio entre duas pessoas usando Flask e Whereby.

## 🚀 Características

- ✅ Reuniões de vídeo e áudio em tempo real
- ✅ 45 minutos gratuitos por reunião
- ✅ Sem cartão de crédito necessário
- ✅ Funciona perfeitamente em produção (Vercel)
- ✅ Suporte completo para desktop e mobile
- ✅ Autenticação com senha para administradores
- ✅ Código único de reunião (8 caracteres)
- ✅ Interface limpa e intuitiva em português
- ✅ Powered by Whereby

## 📋 Pré-requisitos

- Python 3.8 ou superior
- Navegador moderno (Chrome, Firefox, Safari, Edge)
- Conexão com internet

## 🔧 Instalação Local

### 1. Clone o projeto

```bash
git clone https://github.com/aryribeiro/meet-app.git
cd meet-app
```

### 2. Instale as dependências

```bash
pip install -r requirements.txt
```

### 3. Execute o aplicativo

```bash
python app.py
```

O aplicativo abrirá em `http://localhost:5000`

## ☁️ Deploy no Vercel

### Opção 1: Via CLI

```bash
npm i -g vercel
vercel
```

### Opção 2: Via GitHub

1. Faça push do código para GitHub
2. Acesse [vercel.com](https://vercel.com)
3. Clique em "New Project"
4. Importe seu repositório
5. Clique em "Deploy"

**✅ Funciona perfeitamente em produção!**

## 🔐 Credenciais Padrão

**Senha de Administrador:** `admin123`

⚠️ **IMPORTANTE:** Altere a senha no código (`app.py` linha 28) antes de fazer deploy em produção!

## 📖 Como Usar

### Para o Administrador:

1. Acesse o aplicativo
2. Digite a senha: `admin123`
3. Clique em **"Autenticar"**
4. Clique em **"Iniciar Reunião"**
5. Copie o **código de 8 caracteres** gerado
6. Compartilhe o código com o convidado
7. A sala Jitsi abrirá automaticamente
8. Digite seu nome e clique em **"Join meeting"**

### Para o Convidado:

1. Acesse o aplicativo
2. Digite o **código de 8 caracteres** recebido
3. Clique em **"Entrar"**
4. A sala Jitsi abrirá automaticamente
5. Digite seu nome e clique em **"Join meeting"**

### Durante a Reunião:

- **🎥 Câmera:** Controle dentro da interface do Jitsi
- **🎤 Microfone:** Controle dentro da interface do Jitsi
- **💬 Chat:** Disponível no Jitsi
- **🖥️ Compartilhar Tela:** Disponível no Jitsi
- **🚪 Encerrar Reunião:** Clique no botão vermelho

## 🛠️ Estrutura do Projeto

```
meet-app/
│
├── app.py               # Backend Flask
├── templates/
│   └── index.html       # Frontend
├── requirements.txt     # Dependências Python
├── vercel.json         # Configuração Vercel
└── README.md           # Documentação
```

## ⚙️ Tecnologias

- **Flask 3.0** - Framework web Python
- **Whereby** - Plataforma de vídeo conferência (45 min gratuitos)
- **Vercel** - Hospedagem serverless
- **Python 3.8+** - Linguagem de programação

## 🔒 Segurança

- Códigos de reunião são únicos e não repetíveis
- Códigos expiram quando a reunião termina
- Salas temporárias do Jitsi Meet
- Sessões isoladas por usuário

## 🐛 Troubleshooting

### Câmera/Microfone não funcionam

- Verifique permissões do navegador
- Clique em "Join meeting" dentro da interface Jitsi
- Certifique-se de estar usando HTTPS (em produção)

### Não consegue conectar

- Verifique sua conexão com internet
- Recarregue a página
- Tente em navegador diferente

### Código inválido

- Verifique se digitou corretamente (8 caracteres)
- Código pode ter expirado (administrador saiu)
- Peça um novo código ao administrador

## 📝 Limitações

- 45 minutos por reunião (limite do Whereby gratuito)
- Códigos armazenados em memória (não persistem entre deploys)
- Salas temporárias (não há histórico)

## 🚀 Melhorias Futuras

- [ ] Persistência em banco de dados
- [ ] Mais participantes
- [ ] Agendamento de reuniões
- [ ] Histórico de reuniões

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
3. Consulte a documentação do [Whereby](https://whereby.com)
4. Consulte a documentação do [Vercel](https://vercel.com/docs)

## 🙏 Agradecimentos

- [Flask](https://flask.palletsprojects.com) - Framework web Python
- [Whereby](https://whereby.com) - Plataforma de vídeo conferência
- [Vercel](https://vercel.com) - Hospedagem serverless

---

**Desenvolvido com ❤️ usando Flask e Whereby**
