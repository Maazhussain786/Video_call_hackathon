import os
from typing import Dict, List
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx
import urllib.parse
import asyncio

app = FastAPI()

# Enable CORS for all origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory rooms for WebSocket signaling
rooms: Dict[str, List[WebSocket]] = {}

# Simple translation cache
translation_cache: Dict[str, str] = {}


class TranslationRequest(BaseModel):
    text: str
    source_lang: str
    target_lang: str


@app.websocket("/ws/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str):
    await websocket.accept()
    
    if room_id not in rooms:
        rooms[room_id] = []
    rooms[room_id].append(websocket)
    
    try:
        while True:
            text = await websocket.receive_text()
            for client in rooms[room_id]:
                if client != websocket:
                    await client.send_text(text)
    except WebSocketDisconnect:
        if room_id in rooms:
            rooms[room_id].remove(websocket)
            if len(rooms[room_id]) == 0:
                del rooms[room_id]


@app.post("/translate")
async def translate(req: TranslationRequest):
    """Fast async translation with caching."""
    
    # Check cache first
    cache_key = f"{req.text}|{req.source_lang}|{req.target_lang}"
    if cache_key in translation_cache:
        return {"translated": translation_cache[cache_key]}
    
    translated_text = None
    
    try:
        encoded_text = urllib.parse.quote(req.text)
        url = f"https://api.mymemory.translated.net/get?q={encoded_text}&langpair={req.source_lang}|{req.target_lang}"
        
        # Use async HTTP client for faster requests
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(url)
            
            if response.status_code == 200:
                data = response.json()
                if data.get("responseStatus") == 200:
                    translated_text = data.get("responseData", {}).get("translatedText", req.text)
                    # Cache the result
                    translation_cache[cache_key] = translated_text
                    # Limit cache size
                    if len(translation_cache) > 500:
                        # Remove oldest entries
                        keys = list(translation_cache.keys())[:100]
                        for k in keys:
                            del translation_cache[k]
    except Exception as e:
        print(f"Translation error: {e}")
    
    if translated_text is None:
        translated_text = req.text
    
    return {"translated": translated_text}


@app.get("/")
async def root():
    return {"message": "Video call backend is running"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
