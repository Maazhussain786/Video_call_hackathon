"""
MeetFlow Backend - WebRTC Signaling Server with Room Management

Features:
- Room creation with passcode
- Host/participant roles
- Host meeting options (initial mic/cam state for participants)
- Host remote control of participant media
- Chat messaging
- Translation API
"""

import os
from typing import Dict, List, Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx
import urllib.parse
import json

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# Room Data Structure
# ============================================================
# rooms = {
#     room_id: {
#         "passcode": str,
#         "host_joined": bool,
#         "host_ws": WebSocket or None,
#         "clients": [(WebSocket, name, role), ...],
#         "participant_mic_initially_muted": bool,  # Host setting
#         "participant_cam_initially_off": bool,    # Host setting
#     }
# }
rooms: Dict[str, dict] = {}

# Translation cache
translation_cache: Dict[str, str] = {}

# DeepL API Key (Free tier)
DEEPL_API_KEY = "6ef3f2c2-2a1a-4311-90e1-8461b73bcf0a:fx"
DEEPL_API_URL = "https://api-free.deepl.com/v2/translate"


class TranslationRequest(BaseModel):
    text: str
    source_lang: str
    target_lang: str


# ============================================================
# WebSocket Signaling
# ============================================================
@app.websocket("/ws/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str):
    await websocket.accept()
    
    client_name = ""
    client_role = ""
    joined = False
    
    try:
        while True:
            text = await websocket.receive_text()
            data = json.loads(text)
            msg_type = data.get("type")
            
            # --------------------------------------------------------
            # JOIN - Room creation/joining with host options
            # --------------------------------------------------------
            if msg_type == "join":
                client_name = data.get("name", "Anonymous")
                client_role = data.get("role", "participant")
                passcode = data.get("passcode", "")
                
                # Host options for participant initial state
                participant_mic_muted = data.get("participantMicInitiallyMuted", False)
                participant_cam_off = data.get("participantCamInitiallyOff", False)
                
                # Room doesn't exist - only host can create
                if room_id not in rooms:
                    if client_role != "host":
                        await websocket.send_text(json.dumps({
                            "type": "error",
                            "message": "Room does not exist. Only a host can create it."
                        }))
                        await websocket.close()
                        return
                    
                    # Create room with host options
                    rooms[room_id] = {
                        "passcode": passcode,
                        "host_joined": True,
                        "host_ws": websocket,
                        "clients": [(websocket, client_name, client_role)],
                        "participant_mic_initially_muted": participant_mic_muted,
                        "participant_cam_initially_off": participant_cam_off,
                    }
                    joined = True
                    
                    await websocket.send_text(json.dumps({
                        "type": "join-accepted",
                        "isHost": True,
                        "name": client_name
                    }))
                    print(f"[Room {room_id}] Created by host: {client_name}")
                
                # Room exists
                else:
                    room = rooms[room_id]
                    
                    # Check passcode
                    if room["passcode"] != passcode:
                        await websocket.send_text(json.dumps({
                            "type": "error",
                            "message": "Invalid passcode"
                        }))
                        await websocket.close()
                        return
                    
                    # Host already exists
                    if client_role == "host" and room["host_joined"]:
                        await websocket.send_text(json.dumps({
                            "type": "error",
                            "message": "A host is already in this meeting"
                        }))
                        await websocket.close()
                        return
                    
                    # Add client
                    room["clients"].append((websocket, client_name, client_role))
                    joined = True
                    
                    if client_role == "host":
                        room["host_joined"] = True
                        room["host_ws"] = websocket
                        
                        # Notify participants
                        for client_ws, _, _ in room["clients"]:
                            if client_ws != websocket:
                                await client_ws.send_text(json.dumps({"type": "host-joined"}))
                        
                        await websocket.send_text(json.dumps({
                            "type": "join-accepted",
                            "isHost": True,
                            "name": client_name
                        }))
                        print(f"[Room {room_id}] Host joined: {client_name}")
                    
                    else:  # Participant
                        if not room["host_joined"]:
                            await websocket.send_text(json.dumps({"type": "wait-for-host"}))
                            print(f"[Room {room_id}] Participant waiting: {client_name}")
                        else:
                            # Send join-accepted with initial media state from host settings
                            await websocket.send_text(json.dumps({
                                "type": "join-accepted",
                                "isHost": False,
                                "name": client_name,
                                "participantMicInitiallyMuted": room["participant_mic_initially_muted"],
                                "participantCamInitiallyOff": room["participant_cam_initially_off"]
                            }))
                            
                            # Notify others
                            for client_ws, _, _ in room["clients"]:
                                if client_ws != websocket:
                                    await client_ws.send_text(json.dumps({
                                        "type": "peer-joined",
                                        "name": client_name
                                    }))
                            print(f"[Room {room_id}] Participant joined: {client_name}")
            
            # --------------------------------------------------------
            # HOST-CONTROL - Host controls participant media
            # --------------------------------------------------------
            elif msg_type == "host-control" and joined and room_id in rooms:
                room = rooms[room_id]
                
                # Only host can send control messages
                if client_role == "host":
                    # Broadcast to all participants (not host)
                    for client_ws, _, crole in room["clients"]:
                        if client_ws != websocket and crole == "participant":
                            await client_ws.send_text(json.dumps({
                                "type": "host-control",
                                "action": data.get("action"),
                                "from": "host"
                            }))
                    print(f"[Room {room_id}] Host control: {data.get('action')}")
            
            # --------------------------------------------------------
            # CHAT - Broadcast chat messages to all in room
            # --------------------------------------------------------
            elif msg_type == "chat" and joined and room_id in rooms:
                room = rooms[room_id]
                
                # Broadcast to ALL clients including sender
                chat_msg = json.dumps({
                    "type": "chat",
                    "from": data.get("from", client_name),
                    "text": data.get("text", ""),
                    "timestamp": data.get("timestamp", 0)
                })
                
                for client_ws, _, _ in room["clients"]:
                    await client_ws.send_text(chat_msg)
            
            # --------------------------------------------------------
            # Other signaling (offer, answer, ice, caption, etc.)
            # --------------------------------------------------------
            elif joined and room_id in rooms:
                room = rooms[room_id]
                
                # Broadcast to other clients
                for client_ws, _, _ in room["clients"]:
                    if client_ws != websocket:
                        data["senderName"] = client_name
                        await client_ws.send_text(json.dumps(data))
    
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"WebSocket error: {e}")
    finally:
        # Cleanup on disconnect
        if joined and room_id in rooms:
            room = rooms[room_id]
            room["clients"] = [(ws, n, r) for ws, n, r in room["clients"] if ws != websocket]
            
            if client_role == "host":
                room["host_joined"] = False
                room["host_ws"] = None
                
                for client_ws, _, _ in room["clients"]:
                    try:
                        await client_ws.send_text(json.dumps({"type": "host-left"}))
                    except:
                        pass
                print(f"[Room {room_id}] Host left: {client_name}")
            else:
                for client_ws, _, _ in room["clients"]:
                    try:
                        await client_ws.send_text(json.dumps({
                            "type": "peer-left",
                            "name": client_name
                        }))
                    except:
                        pass
                print(f"[Room {room_id}] Participant left: {client_name}")
            
            if len(room["clients"]) == 0:
                del rooms[room_id]
                print(f"[Room {room_id}] Deleted (empty)")


# ============================================================
# Translation API - DeepL (primary) + MyMemory (fallback)
# ============================================================
# DeepL supported languages (doesn't support Urdu, Hindi, Arabic)
DEEPL_SUPPORTED = {"en", "de", "fr", "es", "it", "nl", "pl", "pt", "ru", "ja", "zh", "ko", "bg", "cs", "da", "el", "et", "fi", "hu", "id", "lt", "lv", "nb", "ro", "sk", "sl", "sv", "tr", "uk"}

@app.post("/translate")
async def translate(req: TranslationRequest):
    cache_key = f"{req.text}|{req.source_lang}|{req.target_lang}"
    if cache_key in translation_cache:
        return {"translated": translation_cache[cache_key]}
    
    translated_text = None
    source_lang = req.source_lang.lower()
    target_lang = req.target_lang.lower()
    
    # Use DeepL if both languages are supported, otherwise use MyMemory
    use_deepl = source_lang in DEEPL_SUPPORTED and target_lang in DEEPL_SUPPORTED
    
    async with httpx.AsyncClient(timeout=8.0) as client:
        if use_deepl:
            # DeepL API
            try:
                response = await client.post(
                    DEEPL_API_URL,
                    headers={
                        "Authorization": f"DeepL-Auth-Key {DEEPL_API_KEY}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "text": [req.text],
                        "target_lang": target_lang.upper(),
                        "source_lang": source_lang.upper()
                    }
                )
                
                if response.status_code == 200:
                    data = response.json()
                    translations = data.get("translations", [])
                    if translations:
                        translated_text = translations[0].get("text", req.text)
                        print(f"DeepL: '{req.text}' -> '{translated_text}'")
                else:
                    print(f"DeepL error: {response.status_code}")
            except Exception as e:
                print(f"DeepL error: {e}")
        
        # Fallback to MyMemory for unsupported languages (Urdu, Hindi, Arabic, etc.)
        if translated_text is None:
            try:
                encoded_text = urllib.parse.quote(req.text)
                url = f"https://api.mymemory.translated.net/get?q={encoded_text}&langpair={source_lang}|{target_lang}"
                
                response = await client.get(url)
                
                if response.status_code == 200:
                    data = response.json()
                    if data.get("responseStatus") == 200:
                        translated_text = data.get("responseData", {}).get("translatedText", req.text)
                        print(f"MyMemory: '{req.text}' -> '{translated_text}'")
            except Exception as e:
                print(f"MyMemory error: {e}")
    
    # Cache successful translations
    if translated_text and translated_text != req.text:
        translation_cache[cache_key] = translated_text
        if len(translation_cache) > 500:
            keys = list(translation_cache.keys())[:100]
            for k in keys:
                del translation_cache[k]
    
    return {"translated": translated_text or req.text}


@app.get("/")
async def root():
    return {"message": "MeetFlow backend running", "rooms": len(rooms)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
