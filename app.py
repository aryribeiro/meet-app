from flask import Flask, render_template, request, jsonify, session
import string
import random
import os

app = Flask(__name__)
app.secret_key = os.urandom(24)

# Armazenamento em memória
meetings = {}

def generate_code():
    while True:
        code = ''.join(random.choices(string.ascii_uppercase + string.digits, k=8))
        if code not in meetings:
            return code

def create_room():
    # 8x8.vc - servidor oficial Jitsi
    room_name = ''.join(random.choices(string.ascii_lowercase + string.digits, k=16))
    return f"https://8x8.vc/{room_name}"

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
    room_url = create_room()
    meetings[code] = {'room_url': room_url}
    
    return jsonify({'success': True, 'code': code, 'room_url': room_url})

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
