import streamlit as st
import string
import random
from streamlit_webrtc import webrtc_streamer, WebRtcMode, RTCConfiguration, VideoProcessorBase, AudioProcessorBase
import av
import json
import os
from pathlib import Path
import time
import numpy as np

# Configuração da página
st.set_page_config(
    page_title="Meet!",
    page_icon="📹",
    layout="centered"
)

# Configuração WebRTC com STUN e TURN servers
RTC_CONFIGURATION = RTCConfiguration(
    {
        "iceServers": [
            {"urls": ["stun:stun.l.google.com:19302"]},
            {"urls": ["stun:stun1.l.google.com:19302"]},
            {
                "urls": ["turn:openrelay.metered.ca:80"],
                "username": "openrelayproject",
                "credential": "openrelayproject"
            },
            {
                "urls": ["turn:openrelay.metered.ca:443"],
                "username": "openrelayproject",
                "credential": "openrelayproject"
            }
        ],
        "iceTransportPolicy": "all"
    }
)

# Arquivo para armazenar reuniões ativas (compartilhado entre sessões)
MEETINGS_FILE = Path("active_meetings.json")

# Adicionar ao .gitignore
if not Path(".gitignore").exists() or "active_meetings.json" not in Path(".gitignore").read_text():
    with open(".gitignore", "a") as f:
        f.write("\nactive_meetings.json\n")

def load_meetings():
    """Carrega reuniões ativas do arquivo"""
    if MEETINGS_FILE.exists():
        try:
            with open(MEETINGS_FILE, 'r') as f:
                return json.load(f)
        except:
            return {}
    return {}

def save_meetings(meetings):
    """Salva reuniões ativas no arquivo"""
    with open(MEETINGS_FILE, 'w') as f:
        json.dump(meetings, f)

class VideoProcessor(VideoProcessorBase):
    """Processador de vídeo para controlar transmissão"""
    def __init__(self):
        self.enabled = True
    
    def recv(self, frame):
        if not self.enabled:
            # Retorna frame preto quando desabilitado
            img = frame.to_ndarray(format="bgr24")
            img[:] = 0
            return av.VideoFrame.from_ndarray(img, format="bgr24")
        return frame

# CSS customizado
st.markdown("""
<style>
    .main-title {
        font-size: 3rem;
        font-weight: bold;
        color: #1a73e8;
        text-align: center;
        margin-bottom: 2rem;
    }
    .stButton>button {
        width: 100%;
        height: 3rem;
        font-size: 1.1rem;
        font-weight: 600;
        border-radius: 8px;
    }
    .meeting-code {
        font-size: 2rem;
        font-weight: bold;
        color: #1a73e8;
        text-align: center;
        padding: 1rem;
        background-color: #e8f0fe;
        border-radius: 8px;
        margin: 1rem 0;
    }
    .status-connected {
        color: #0f9d58;
        font-weight: bold;
    }
    .status-disconnected {
        color: #ea4335;
        font-weight: bold;
    }
    /* Ocultar TODOS os botões da coluna do participante remoto */
    [data-testid="column"]:last-child button {
        display: none !important;
    }
    [data-testid="column"]:last-child .stButton {
        display: none !important;
    }
    /* Estilizar botões do webrtc em azul */
    button[kind="primary"], button[kind="secondary"] {
        background-color: #1a73e8 !important;
        color: white !important;
        border: none !important;
    }
    button[kind="primary"]:hover, button[kind="secondary"]:hover {
        background-color: #1557b0 !important;
    }
    /* Forçar todos os botões do streamlit-webrtc em azul */
    .stButton button:not(:disabled) {
        background-color: #1a73e8 !important;
        color: white !important;
    }
</style>
""", unsafe_allow_html=True)

# Inicializar session state
if 'authenticated' not in st.session_state:
    st.session_state.authenticated = False
if 'meeting_code' not in st.session_state:
    st.session_state.meeting_code = None
if 'is_host' not in st.session_state:
    st.session_state.is_host = False
if 'in_meeting' not in st.session_state:
    st.session_state.in_meeting = False
if 'audio_enabled' not in st.session_state:
    st.session_state.audio_enabled = True
if 'video_enabled' not in st.session_state:
    st.session_state.video_enabled = True
if 'admin_password' not in st.session_state:
    st.session_state.admin_password = "admin123"

def generate_meeting_code():
    """Gera código único de 8 caracteres"""
    meetings = load_meetings()
    while True:
        code = ''.join(random.choices(string.ascii_uppercase + string.digits, k=8))
        if code not in meetings:
            return code

def validate_meeting_code(code):
    """Valida se o código existe"""
    meetings = load_meetings()
    return code in meetings

def start_meeting():
    """Inicia uma nova reunião"""
    code = generate_meeting_code()
    meetings = load_meetings()
    meetings[code] = {'host': True, 'guest': False}
    save_meetings(meetings)
    st.session_state.meeting_code = code
    st.session_state.in_meeting = True
    st.session_state.is_host = True

def join_meeting(code):
    """Entra em uma reunião existente"""
    if validate_meeting_code(code):
        meetings = load_meetings()
        meetings[code]['guest'] = True
        save_meetings(meetings)
        st.session_state.meeting_code = code
        st.session_state.in_meeting = True
        st.session_state.is_host = False
        return True
    return False

def end_meeting():
    """Encerra a reunião"""
    if st.session_state.meeting_code:
        meetings = load_meetings()
        if st.session_state.meeting_code in meetings:
            del meetings[st.session_state.meeting_code]
            save_meetings(meetings)
    st.session_state.meeting_code = None
    st.session_state.in_meeting = False
    st.session_state.is_host = False
    st.session_state.authenticated = False

# Título principal
st.markdown('<div class="main-title">📹 Meet!</div>', unsafe_allow_html=True)

# Tela principal
if not st.session_state.in_meeting:
    st.markdown("### Bem-vindo ao Meet!")
    st.markdown("Reuniões de vídeo simples e diretas entre duas pessoas.")
    
    col1, col2 = st.columns(2)
    
    with col1:
        st.markdown("#### 🎯 Iniciar Reunião")
        if not st.session_state.authenticated:
            with st.form("admin_form"):
                password = st.text_input("Senha de Administrador", type="password")
                submit = st.form_submit_button("Autenticar")
                
                if submit:
                    if password == st.session_state.admin_password:
                        st.session_state.authenticated = True
                        st.rerun()
                    else:
                        st.error("❌ Senha incorreta!")
        else:
            with st.form("config_form"):
                st.success("✅ Autenticado!")
                st.session_state.video_enabled = st.checkbox("🎥 Ativar câmera", value=True)
                st.session_state.audio_enabled = st.checkbox("🎤 Ativar microfone", value=True)
                if st.form_submit_button("🚀 Iniciar Reunião"):
                    start_meeting()
                    st.rerun()
    
    with col2:
        st.markdown("#### 🚪 Entrar em Reunião")
        with st.form("join_form"):
            code_input = st.text_input("Código da Reunião", max_chars=8).upper()
            st.session_state.video_enabled = st.checkbox("🎥 Ativar câmera", value=True, key="video_join")
            st.session_state.audio_enabled = st.checkbox("🎤 Ativar microfone", value=True, key="audio_join")
            join_btn = st.form_submit_button("Entrar")
            
            if join_btn:
                if len(code_input) == 8:
                    if join_meeting(code_input):
                        st.rerun()
                    else:
                        st.error("❌ Código inválido ou reunião não encontrada!")
                else:
                    st.error("❌ O código deve ter 8 caracteres!")

else:
    # Tela de reunião
    st.markdown(f"### {'🎯 Você é o Anfitrião' if st.session_state.is_host else '👤 Você é o Convidado'}")
    
    if st.session_state.is_host:
        st.markdown(f'<div class="meeting-code">Código: {st.session_state.meeting_code}</div>', unsafe_allow_html=True)
        st.info("📋 Compartilhe este código com seu convidado")
        
        # Opção de alterar senha
        with st.expander("🔐 Alterar Senha de Administrador"):
            with st.form("change_password_form"):
                new_password = st.text_input("Nova Senha", type="password")
                confirm_password = st.text_input("Confirmar Senha", type="password")
                if st.form_submit_button("Alterar Senha"):
                    if new_password and new_password == confirm_password:
                        st.session_state.admin_password = new_password
                        st.success("✅ Senha alterada com sucesso!")
                    elif not new_password:
                        st.error("❌ Digite uma nova senha")
                    else:
                        st.error("❌ As senhas não coincidem")
    
    # Status da conexão
    meetings = load_meetings()
    meeting_info = meetings.get(st.session_state.meeting_code, {})
    if meeting_info.get('host') and meeting_info.get('guest'):
        st.markdown('<p class="status-connected">🟢 Conectado - 2 participantes</p>', unsafe_allow_html=True)
    else:
        st.markdown('<p class="status-disconnected">🟡 Aguardando participante...</p>', unsafe_allow_html=True)
    
    st.markdown("---")
    
    # Área de vídeo
    col1, col2 = st.columns(2)
    
    with col1:
        st.markdown("#### 📹 Seu Vídeo")
        
        webrtc_ctx = webrtc_streamer(
            key="local_stream",
            mode=WebRtcMode.SENDRECV,
            rtc_configuration=RTC_CONFIGURATION,
            media_stream_constraints={
                "video": st.session_state.video_enabled,
                "audio": st.session_state.audio_enabled
            },
            async_processing=False,
            translations={
                "start": "Iniciar",
                "stop": "Parar",
                "select_device": "Selecionar Dispositivo",
                "media_api_not_available": "API de mídia não disponível",
                "device_ask_permission": "Permita acesso à câmera e microfone",
                "device_not_available": "Dispositivo não disponível",
                "device_access_denied": "Acesso negado"
            }
        )
        
        st.write("")  # Espaçador
        
        if st.session_state.video_enabled:
            st.success("🎥 Câmera ativa")
        else:
            st.info("📷 Câmera desligada")
        
        if st.session_state.audio_enabled:
            st.success("🎤 Microfone ativo")
        else:
            st.info("🔇 Microfone desligado")
    
    with col2:
        st.markdown("#### 👤 Participante Remoto")
        meetings = load_meetings()
        meeting_info = meetings.get(st.session_state.meeting_code, {})
        if meeting_info.get('host') and meeting_info.get('guest'):
            webrtc_remote = webrtc_streamer(
                key="remote_stream",
                mode=WebRtcMode.SENDRECV,
                rtc_configuration=RTC_CONFIGURATION,
                media_stream_constraints={
                    "video": True,
                    "audio": True
                },
                async_processing=False,
                translations={
                    "start": "Iniciar",
                    "stop": "Parar",
                    "select_device": "Selecionar Dispositivo"
                }
            )
        else:
            st.info("⏳ Aguardando participante conectar...")
    
    st.markdown("---")
    
    # Controles
    if st.button("🚪 Encerrar Reunião", type="primary", use_container_width=True):
        end_meeting()
        st.rerun()
    
    st.markdown("---")
    st.markdown("""
    **💡 Dicas:**
    - Escolha áudio/vídeo antes de entrar na reunião
    - Funciona apenas com microfone (sem câmera)
    - Use fones de ouvido para evitar eco
    - Certifique-se de ter uma conexão estável
    """)

# Footer
st.markdown("---")
st.markdown(
    '<div style="text-align: center; color: #666; font-size: 0.9rem;">Meet! - Reuniões simples e diretas</div>',
    unsafe_allow_html=True
)
