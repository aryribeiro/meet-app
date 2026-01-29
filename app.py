from flask import Flask, render_template, request, jsonify, session
import string
import random
import os
import requests
import time
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
app.secret_key = os.urandom(24)

# Armazenamento em memória
meetings = {}

def generate_code():
    while True:
        code = ''.join(random.choices(string.ascii_uppercase + string.digits, k=8))
        if code not in meetings:
            return code

def create_daily_room():
    api_key = os.getenv('DAILY_API_KEY')
    
    if not api_key:
        return {'error': 'API key não configurada'}
    
    # Cria sala via API Daily.co
    response = requests.post(
        'https://api.daily.co/v1/rooms',
        headers={'Authorization': f'Bearer {api_key}'},
        json={
            'properties': {
                'exp': int(time.time()) + 3600,  # Expira em 1 hora
                'max_participants': 2  # Apenas 2 pessoas
            }
        }
    )
    
    if response.status_code == 200:
        return {'url': response.json()['url']}
    else:
        return {'error': 'Erro ao criar sala'}

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/auth', methods=['POST'])
def auth():
    data = request.json
    if data.get('password') == 'admin123':
        session['authenticated'] = True
        return jsonify({'success': True})
    return jsonify({'success': False, 'error': 'Senha incorreta'})

@app.route('/api/start', methods=['POST'])
def start_meeting():
    if not session.get('authenticated'):
        return jsonify({'success': False, 'error': 'Não autenticado'}), 401
    
    code = generate_code()
    room_result = create_daily_room()
    
    if 'error' in room_result:
        return jsonify({'success': False, 'error': room_result['error']}), 500
    
    meetings[code] = {'room_url': room_result['url']}
    
    return jsonify({'success': True, 'code': code, 'room_url': room_result['url']})

@app.route('/api/join', methods=['POST'])
def join_meeting():
    data = request.json
    code = data.get('code', '').upper()
    
    if code in meetings:
        return jsonify({'success': True, 'room_url': meetings[code]['room_url']})
    return jsonify({'success': False, 'error': 'Código inválido'})

@app.route('/api/end', methods=['POST'])
def end_meeting():
    data = request.json
    code = data.get('code')
    if code in meetings:
        del meetings[code]
    session.clear()
    return jsonify({'success': True})

if __name__ == '__main__':
    app.run(debug=True)
