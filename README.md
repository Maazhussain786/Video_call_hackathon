# Hackathon Video Call with Live Captions & Translation

A minimal two-person video call application with live speech-to-text captions and real-time translation.

## Features

- **Two-person video call** using WebRTC (peer-to-peer)
- **Live captions** using browser Web Speech API
- **Real-time translation** using OpenAI API (with LibreTranslate fallback)

## Tech Stack

- **Backend**: Python, FastAPI, uvicorn
- **Frontend**: Plain HTML + JavaScript (no frameworks)
- **Real-time media**: WebRTC
- **Speech recognition**: Browser Web Speech API
- **Translation**: OpenAI API

## Project Structure

```
project-root/
├── backend/
│   ├── main.py
│   └── requirements.txt
├── frontend/
│   ├── index.html
│   └── app.js
└── README.md
```

## Setup Instructions (Ubuntu Linux)

### 1. Set Environment Variables

```bash
export OPENAI_API_KEY="your-openai-api-key-here"
export OPENAI_MODEL="gpt-5.1"
```

You can add these to your `~/.bashrc` for persistence:

```bash
echo 'export OPENAI_API_KEY="your-key"' >> ~/.bashrc
echo 'export OPENAI_MODEL="gpt-5.1"' >> ~/.bashrc
source ~/.bashrc
```

### 2. Install Backend Dependencies

```bash
cd backend
pip install -r requirements.txt
```

Or with pip3:

```bash
pip3 install -r requirements.txt
```

### 3. Run the Backend Server

```bash
cd backend
uvicorn main:app --host 0.0.0.0 --port 8001 --reload
```

Or run directly with Python:

```bash
python3 main.py
```

The backend will be available at `http://localhost:8001`

### 4. Serve the Frontend

**Option A**: Open directly in browser

Open `frontend/index.html` directly in Chrome (recommended for Web Speech API support).

**Option B**: Use Python's built-in HTTP server

```bash
cd frontend
python3 -m http.server 5500
```

Then open `http://localhost:5500` in your browser.

## How to Test

1. **Start the backend server** (see step 3 above)

2. **Open the frontend** in two different browser windows/tabs (or on two different devices on the same network)

3. **Click "Start Call"** on both windows

4. **Allow camera and microphone** access when prompted

5. **Speak into one side** - you should see:
   - Live video of both users
   - Captions in the original spoken language (English)
   - Translated text underneath (Urdu)

## Configuration

The following can be changed in `frontend/app.js`:

```javascript
const wsUrl = "ws://localhost:8000/ws/room1"; // WebSocket signaling URL
const apiBase = "http://localhost:8000";      // Backend API URL
const SPOKEN_LANG = "en-US";                  // Speech recognition language
const TARGET_LANG = "ur";                     // Translation target language
```

## API Endpoints

### WebSocket Signaling
- **Endpoint**: `GET /ws/{room_id}`
- **Purpose**: WebRTC signaling for peer connection

### Translation
- **Endpoint**: `POST /translate`
- **Body**: 
  ```json
  {
    "text": "Hello world",
    "source_lang": "en",
    "target_lang": "ur"
  }
  ```
- **Response**:
  ```json
  {
    "translated": "ہیلو ورلڈ"
  }
  ```

## Troubleshooting

### Speech Recognition Not Working
- Use Google Chrome (recommended) - it has the best Web Speech API support
- Make sure microphone permissions are granted
- Check that HTTPS is used if not on localhost

### Video Call Not Connecting
- Ensure both browsers are using the same room (default: "room1")
- Check that the backend server is running
- Verify WebSocket connection in browser console

### Translation Not Working
- Verify `OPENAI_API_KEY` environment variable is set
- Check backend console for error messages
- The system will fallback to returning original text if translation fails

## Browser Support

- **Recommended**: Google Chrome (best Web Speech API support)
- **Works**: Microsoft Edge
- **Limited**: Firefox (may have issues with Web Speech API)
- **Not Supported**: Safari on some versions

## License

MIT - Free to use for hackathons and demos.

