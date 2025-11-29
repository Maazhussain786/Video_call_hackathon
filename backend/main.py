"""
Video Call Backend with Room Management
- WebSocket signaling for WebRTC
- Room + passcode + host/participant logic
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

# Enable CORS for all origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# Room Management Data Structure
# ============================================================
# rooms = {
#     room_id: {
#         "passcode": "1234",
#         "host_joined": True/False,
#         "host_ws": WebSocket or None,
#         "clients": [(WebSocket, name, role), ...]
#     }
# }
rooms: Dict[str, dict] = {}

# Translation cache
translation_cache: Dict[str, str] = {}


class TranslationRequest(BaseModel):
    text: str
    source_lang: str
    target_lang: str


# ============================================================
# WebSocket Signaling with Room/Host Logic
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
            # Handle JOIN message (must be first message from client)
            # --------------------------------------------------------
            if msg_type == "join":
                client_name = data.get("name", "Anonymous")
                client_role = data.get("role", "participant")
                passcode = data.get("passcode", "")
                
                # Case 1: Room doesn't exist yet
                if room_id not in rooms:
                    if client_role != "host":
                        # Only host can create a room
                        await websocket.send_text(json.dumps({
                            "type": "error",
                            "message": "Room does not exist. Only a host can create it."
                        }))
                        await websocket.close()
                        return
                    
                    # Create new room
                    rooms[room_id] = {
                        "passcode": passcode,
                        "host_joined": True,
                        "host_ws": websocket,
                        "clients": [(websocket, client_name, client_role)]
                    }
                    joined = True
                    
                    await websocket.send_text(json.dumps({
                        "type": "join-accepted",
                        "isHost": True,
                        "name": client_name
                    }))
                    print(f"[Room {room_id}] Created by host: {client_name}")
                
                # Case 2: Room already exists
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
                    
                    # Check if trying to join as host when host exists
                    if client_role == "host" and room["host_joined"]:
                        await websocket.send_text(json.dumps({
                            "type": "error",
                            "message": "A host is already in this meeting"
                        }))
                        await websocket.close()
                        return
                    
                    # Add client to room
                    room["clients"].append((websocket, client_name, client_role))
                    joined = True
                    
                    if client_role == "host":
                        room["host_joined"] = True
                        room["host_ws"] = websocket
                        
                        # Notify all participants that host joined
                        for client_ws, _, _ in room["clients"]:
                            if client_ws != websocket:
                                await client_ws.send_text(json.dumps({
                                    "type": "host-joined"
                                }))
                        
                        await websocket.send_text(json.dumps({
                            "type": "join-accepted",
                            "isHost": True,
                            "name": client_name
                        }))
                        print(f"[Room {room_id}] Host joined: {client_name}")
                    
                    else:  # participant
                        if not room["host_joined"]:
                            await websocket.send_text(json.dumps({
                                "type": "wait-for-host"
                            }))
                            print(f"[Room {room_id}] Participant waiting: {client_name}")
                        else:
                            await websocket.send_text(json.dumps({
                                "type": "join-accepted",
                                "isHost": False,
                                "name": client_name
                            }))
                            
                            # Notify others that someone joined
                            for client_ws, cname, _ in room["clients"]:
                                if client_ws != websocket:
                                    await client_ws.send_text(json.dumps({
                                        "type": "peer-joined",
                                        "name": client_name
                                    }))
                            print(f"[Room {room_id}] Participant joined: {client_name}")
            
            # --------------------------------------------------------
            # Handle other signaling messages (offer, answer, ice, etc.)
            # --------------------------------------------------------
            elif joined and room_id in rooms:
                room = rooms[room_id]
                
                # Broadcast to all other clients in the room
                for client_ws, _, _ in room["clients"]:
                    if client_ws != websocket:
                        # Add sender name to the message
                        data["senderName"] = client_name
                        await client_ws.send_text(json.dumps(data))
    
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"WebSocket error: {e}")
    finally:
        # Clean up on disconnect
        if joined and room_id in rooms:
            room = rooms[room_id]
            
            # Remove client from room
            room["clients"] = [(ws, n, r) for ws, n, r in room["clients"] if ws != websocket]
            
            # If host disconnected
            if client_role == "host":
                room["host_joined"] = False
                room["host_ws"] = None
                
                # Notify remaining clients
                for client_ws, _, _ in room["clients"]:
                    try:
                        await client_ws.send_text(json.dumps({
                            "type": "host-left"
                        }))
                    except:
                        pass
                print(f"[Room {room_id}] Host left: {client_name}")
            else:
                # Notify others that peer left
                for client_ws, _, _ in room["clients"]:
                    try:
                        await client_ws.send_text(json.dumps({
                            "type": "peer-left",
                            "name": client_name
                        }))
                    except:
                        pass
                print(f"[Room {room_id}] Participant left: {client_name}")
            
            # Delete room if empty
            if len(room["clients"]) == 0:
                del rooms[room_id]
                print(f"[Room {room_id}] Deleted (empty)")


# ============================================================
# Translation API
# ============================================================
@app.post("/translate")
async def translate(req: TranslationRequest):
    """Fast async translation with caching using MyMemory API."""
    
    # Check cache first
    cache_key = f"{req.text}|{req.source_lang}|{req.target_lang}"
    if cache_key in translation_cache:
        return {"translated": translation_cache[cache_key]}
    
    translated_text = None
    
    try:
        encoded_text = urllib.parse.quote(req.text)
        url = f"https://api.mymemory.translated.net/get?q={encoded_text}&langpair={req.source_lang}|{req.target_lang}"
        
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(url)
            
            if response.status_code == 200:
                data = response.json()
                if data.get("responseStatus") == 200:
                    translated_text = data.get("responseData", {}).get("translatedText", req.text)
                    translation_cache[cache_key] = translated_text
                    
                    # Limit cache size
                    if len(translation_cache) > 500:
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
    return {"message": "Video call backend is running", "active_rooms": len(rooms)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
