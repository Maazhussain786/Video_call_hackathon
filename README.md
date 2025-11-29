# 🎥 MeetFlow

**Real-time Video Conferencing with Live Captions & Translation**

A modern video conferencing application built for seamless communication across language barriers. Features YouTube-style live captions, real-time translation powered by DeepL, and a beautiful dark-themed UI.

![MeetFlow](https://img.shields.io/badge/MeetFlow-Video%20Conferencing-00a884?style=for-the-badge&logo=webrtc)
![WebRTC](https://img.shields.io/badge/WebRTC-Peer%20to%20Peer-333333?style=flat-square&logo=webrtc)
![Python](https://img.shields.io/badge/Python-FastAPI-3776ab?style=flat-square&logo=python)
![JavaScript](https://img.shields.io/badge/JavaScript-Vanilla-f7df1e?style=flat-square&logo=javascript)

---

## ✨ Features

### 🎬 Video Calling
- **Peer-to-peer WebRTC** connection for low-latency video calls
- **Screen sharing** with face cam picture-in-picture
- **Camera & microphone** toggle controls

### 📝 Live Captions (YouTube-style)
- **Real-time speech recognition** using Web Speech API
- **Translucent captions** overlaid on video (like YouTube subtitles)
- **Caption history** panel with timestamps
- **Auto-hide** captions after display

### 🌐 Real-time Translation
- **DeepL API** for high-quality translation (German, French, Spanish, etc.)
- **MyMemory fallback** for languages not supported by DeepL (Urdu, Hindi, Arabic)
- **Instant translation** of captions in real-time
- **6+ languages** supported

### 💬 In-Meeting Chat
- **Real-time messaging** during calls
- **Message history** with timestamps
- **Sender identification**

### 👑 Host Controls
- **Create meetings** with custom passcode
- **Control participant media** (mute/unmute, camera on/off)
- **Set default participant settings** (join with mic/camera off)

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| **Backend** | Python, FastAPI, Uvicorn |
| **Frontend** | HTML5, CSS3, Vanilla JavaScript |
| **Real-time** | WebRTC, WebSockets |
| **Speech** | Web Speech API (SpeechRecognition) |
| **Translation** | DeepL API, MyMemory API |
| **Icons** | Font Awesome 6 |

---

## 📁 Project Structure

```
MeetFlow/
├── backend/
│   ├── main.py              # FastAPI server (WebSocket signaling + Translation API)
│   └── requirements.txt     # Python dependencies
├── frontend/
│   ├── index.html           # Main UI (Join screen + Meeting screen)
│   └── app.js               # Client-side logic (WebRTC, Speech, Chat)
└── README.md
```

---

## 🚀 Quick Start

### Prerequisites
- Python 3.8+
- Modern browser (Chrome recommended for Speech API)
- Camera & microphone

### 1. Clone & Setup

```bash
git clone <repository-url>
cd MeetFlow
```

### 2. Install Backend Dependencies

```bash
cd backend
pip install -r requirements.txt
```

### 3. Start the Backend Server

```bash
python main.py
```

Server runs at `http://0.0.0.0:8001`

### 4. Serve the Frontend

```bash
cd frontend
python -m http.server 5500
```

Frontend available at `http://localhost:5500`

### 5. Access from Other Devices

Replace `localhost` with your machine's IP address:
- Find IP: `hostname -I | awk '{print $1}'`
- Update `HOST` variable in `frontend/app.js`
- Access: `http://<your-ip>:5500`

> **Note:** For camera/mic access on non-localhost, add the URL to Chrome's insecure origins:
> `chrome://flags/#unsafely-treat-insecure-origin-as-secure`

---

## 📖 How to Use

### Starting a Meeting (Host)

1. Enter your **name**
2. Create a **Meeting ID** (e.g., `team-standup`)
3. Set a **Passcode**
4. Select **"Host"** role
5. Optionally check participant settings
6. Click **"Join Meeting"**

### Joining a Meeting (Participant)

1. Enter your **name**
2. Enter the **same Meeting ID** as the host
3. Enter the **same Passcode**
4. Select **"Participant"** role
5. Click **"Join Meeting"**

### During the Meeting

| Control | Action |
|---------|--------|
| 🎤 | Toggle microphone |
| 📹 | Toggle camera |
| 🖥️ | Share screen |
| CC | Toggle captions |
| ☰ | Toggle sidebar (Captions/Chat) |
| 📵 | Leave meeting |

---

## 🌍 Supported Languages

### Speech Recognition
English, Urdu, Hindi, Spanish, French, German, Chinese, Arabic

### Translation
| DeepL (Primary) | MyMemory (Fallback) |
|-----------------|---------------------|
| English, German, French, Spanish, Italian, Dutch, Polish, Portuguese, Russian, Japanese, Chinese, Korean | Urdu, Hindi, Arabic, and 50+ more |

---

## ⚙️ Configuration

### Backend (`backend/main.py`)

```python
# DeepL API Key (line ~51)
DEEPL_API_KEY = "your-deepl-api-key:fx"

# Server Port (line ~273)
uvicorn.run(app, host="0.0.0.0", port=8001)
```

### Frontend (`frontend/app.js`)

```javascript
// Server IP (line ~6)
const HOST = "10.7.48.13";  // Change to your server IP
```

---

## 🔌 API Endpoints

### WebSocket Signaling
```
WS /ws/{room_id}
```
Handles: `join`, `offer`, `answer`, `ice`, `caption`, `chat`, `host-control`

### Translation
```
POST /translate
Content-Type: application/json

{
  "text": "Hello",
  "source_lang": "en",
  "target_lang": "ur"
}

Response: { "translated": "ہیلو" }
```

### Health Check
```
GET /
Response: { "message": "MeetFlow backend running", "rooms": 0 }
```

---

## 🎨 Screenshots

### Join Screen
- Clean, modern dark theme
- Host/Participant role selection
- Participant settings for hosts

### Meeting Screen
- YouTube-style captions overlay
- Picture-in-picture self view
- Sidebar with Captions history & Chat tabs
- Intuitive control bar

---

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| Camera/mic not working | Check browser permissions, ensure no other app is using them |
| Speech recognition not working | Use Chrome browser, check mic permissions |
| Can't connect from other device | Use IP address instead of localhost, check firewall |
| Translation returning original text | Check DeepL API key, verify language is supported |
| Port already in use | Kill existing process: `pkill -f "python main.py"` |

---

## 🤝 Contributors

<table>
  <tr>
    <td align="center">
      <b>Maaz Hussain</b><br>
      <sub>Full Stack Developer</sub>
    </td>
    <td align="center">
      <b>Muhammad Abdul Daym</b><br>
      <sub>Full Stack Developer</sub>
    </td>
  </tr>
</table>

---

## 📄 License

This project is open source and available under the [MIT License](LICENSE).

---

## 🙏 Acknowledgments

- [WebRTC](https://webrtc.org/) - Real-time communication
- [DeepL](https://www.deepl.com/) - Translation API
- [Font Awesome](https://fontawesome.com/) - Icons
- [Google STUN](https://webrtc.github.io/samples/) - STUN server

---

<p align="center">
  Made with ❤️ for seamless global communication
</p>
