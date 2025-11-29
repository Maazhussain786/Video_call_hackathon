// Configuration - Use your machine's IP for cross-device access
const HOST = "10.7.48.13";  // Change this to your IP address
const apiBase = `http://${HOST}:8001`;

// DOM elements
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const startBtn = document.getElementById("startBtn");
const endBtn = document.getElementById("endBtn");
const myLanguageSelect = document.getElementById("myLanguage");
const myTranslateToSelect = document.getElementById("myTranslateTo");
const roomIdSelect = document.getElementById("roomId");

// Caption elements
const myCaptionDiv = document.getElementById("myCaption");
const myTranslationDiv = document.getElementById("myTranslation");
const peerCaptionDiv = document.getElementById("peerCaption");
const peerTranslationDiv = document.getElementById("peerTranslation");

// Status elements
const yourStatus = document.getElementById("yourStatus");
const yourStatusText = document.getElementById("yourStatusText");
const peerStatus = document.getElementById("peerStatus");
const peerStatusText = document.getElementById("peerStatusText");
const roomDisplay = document.getElementById("roomDisplay");
const connectionStatus = document.getElementById("connectionStatus");

// WebRTC and WebSocket variables
let pc = null;
let ws = null;
let localStream = null;
let recognition = null;
let isCallActive = false;

// Translation cache for speed
const translationCache = new Map();

// Debounce timer for translation
let translationTimer = null;

// Get WebSocket URL based on selected room
function getWsUrl() {
    return `ws://${HOST}:8001/ws/${roomIdSelect.value}`;
}

// Start button click handler
startBtn.addEventListener("click", async () => {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
        
        startBtn.style.display = "none";
        endBtn.style.display = "inline-flex";
        roomIdSelect.disabled = true;
        roomDisplay.textContent = roomIdSelect.value;
        
        setupWebSocket();
        startSpeechRecognition();
        
        isCallActive = true;
        updateStatus("yours", true, "Listening...");
        connectionStatus.textContent = "🟡 Connecting...";
        
    } catch (err) {
        console.error("Error starting call:", err);
        handleMediaError(err);
    }
});

// End button click handler
endBtn.addEventListener("click", () => {
    endCall();
});

function endCall() {
    isCallActive = false;
    
    if (recognition) {
        recognition.stop();
        recognition = null;
    }
    
    if (pc) {
        pc.close();
        pc = null;
    }
    
    if (ws) {
        ws.close();
        ws = null;
    }
    
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
    
    startBtn.style.display = "inline-flex";
    endBtn.style.display = "none";
    roomIdSelect.disabled = false;
    
    myCaptionDiv.textContent = "Waiting for speech...";
    myTranslationDiv.textContent = "-";
    peerCaptionDiv.textContent = "Waiting for peer to speak...";
    peerTranslationDiv.textContent = "-";
    
    updateStatus("yours", false, "Not Connected");
    updateStatus("peer", false, "Waiting for peer...");
    connectionStatus.textContent = "⚪ Disconnected";
}

function updateStatus(who, connected, text) {
    if (who === "yours") {
        yourStatus.className = connected ? "status-dot connected" : "status-dot";
        yourStatusText.textContent = text;
    } else {
        peerStatus.className = connected ? "status-dot connected" : "status-dot";
        peerStatusText.textContent = text;
    }
}

function handleMediaError(err) {
    let errorMsg = "Error starting call: " + err.message;
    
    if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        errorMsg = "Camera/Microphone permission denied.\n\nPlease allow access in browser settings.";
    } else if (err.name === "NotFoundError") {
        errorMsg = "No camera or microphone found.";
    } else if (err.name === "NotReadableError") {
        errorMsg = "Camera/microphone is in use by another app.";
    }
    
    alert(errorMsg);
}

function setupWebSocket() {
    ws = new WebSocket(getWsUrl());
    
    ws.onopen = () => {
        console.log("WebSocket connected");
        ws.send(JSON.stringify({ type: "join" }));
    };
    
    ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        
        switch (data.type) {
            case "join":
                createPeerConnection();
                await makeOffer();
                break;
                
            case "offer":
                createPeerConnection();
                await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                ws.send(JSON.stringify({ type: "answer", answer }));
                break;
                
            case "answer":
                await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
                break;
                
            case "ice":
                if (pc && data.candidate) {
                    try {
                        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
                    } catch (err) {
                        console.error("ICE error:", err);
                    }
                }
                break;
                
            case "caption":
                handlePeerCaption(data);
                break;
        }
    };
    
    ws.onerror = () => {
        connectionStatus.textContent = "🔴 Connection Error";
    };
    
    ws.onclose = () => {
        if (isCallActive) {
            connectionStatus.textContent = "🔴 Disconnected";
        }
    };
}

// Handle caption from peer - show immediately, translate async
async function handlePeerCaption(data) {
    // Show original immediately
    peerCaptionDiv.textContent = data.text;
    updateStatus("peer", true, "Speaking...");
    
    // Translate asynchronously
    const myTargetLang = myTranslateToSelect.value;
    const peerSourceLang = data.sourceLang || "en";
    
    if (peerSourceLang !== myTargetLang) {
        // Show "translating..." indicator
        peerTranslationDiv.textContent = "⏳ Translating...";
        const translated = await translateText(data.text, peerSourceLang, myTargetLang);
        peerTranslationDiv.textContent = translated;
    } else {
        peerTranslationDiv.textContent = data.text;
    }
    
    setTimeout(() => updateStatus("peer", true, "Connected"), 1500);
}

function createPeerConnection() {
    if (pc) return;
    
    pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });
    
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    
    pc.ontrack = (event) => {
        remoteVideo.srcObject = event.streams[0];
        updateStatus("peer", true, "Connected");
        connectionStatus.textContent = "🟢 Connected";
    };
    
    pc.onicecandidate = (event) => {
        if (event.candidate && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ice", candidate: event.candidate }));
        }
    };
    
    pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === "connected") {
            connectionStatus.textContent = "🟢 Connected";
        } else if (pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed") {
            connectionStatus.textContent = "🔴 Disconnected";
            updateStatus("peer", false, "Disconnected");
        }
    };
}

async function makeOffer() {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    ws.send(JSON.stringify({ type: "offer", offer }));
}

function startSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
        alert("Speech recognition not supported. Use Chrome.");
        return;
    }
    
    recognition = new SpeechRecognition();
    recognition.lang = myLanguageSelect.value;
    recognition.continuous = true;
    recognition.interimResults = true;
    
    recognition.onresult = (event) => {
        let interimTranscript = "";
        let finalTranscript = "";
        
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            
            if (event.results[i].isFinal) {
                finalTranscript += transcript;
            } else {
                interimTranscript += transcript;
            }
        }
        
        // Show captions immediately (no waiting)
        if (finalTranscript) {
            myCaptionDiv.textContent = finalTranscript;
            
            // Send to peer immediately
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: "caption",
                    text: finalTranscript,
                    sourceLang: myLanguageSelect.value.split("-")[0]
                }));
            }
            
            // Translate in background (debounced)
            debouncedTranslate(finalTranscript);
            
        } else if (interimTranscript) {
            // Show interim results immediately
            myCaptionDiv.textContent = interimTranscript;
            myCaptionDiv.style.opacity = "0.7";
        }
    };
    
    recognition.onerror = (event) => {
        console.error("Speech error:", event.error);
    };
    
    recognition.onend = () => {
        if (isCallActive && recognition) {
            try {
                recognition.start();
            } catch (e) {}
        }
    };
    
    recognition.start();
}

// Debounced translation to avoid too many requests
function debouncedTranslate(text) {
    clearTimeout(translationTimer);
    
    translationTimer = setTimeout(async () => {
        myCaptionDiv.style.opacity = "1";
        updateStatus("yours", true, "Translating...");
        
        const myLang = myLanguageSelect.value.split("-")[0];
        const targetLang = myTranslateToSelect.value;
        
        const translated = await translateText(text, myLang, targetLang);
        myTranslationDiv.textContent = translated;
        
        updateStatus("yours", true, "Listening...");
    }, 300); // 300ms debounce
}

// Update speech recognition language when changed
myLanguageSelect.addEventListener("change", () => {
    if (recognition && isCallActive) {
        recognition.stop();
        setTimeout(() => {
            recognition.lang = myLanguageSelect.value;
            recognition.start();
        }, 100);
    }
});

// Fast translation with caching
async function translateText(text, sourceLang, targetLang) {
    // Check cache first
    const cacheKey = `${text}|${sourceLang}|${targetLang}`;
    if (translationCache.has(cacheKey)) {
        return translationCache.get(cacheKey);
    }
    
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout
        
        const res = await fetch(`${apiBase}/translate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, source_lang: sourceLang, target_lang: targetLang }),
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        const data = await res.json();
        const translated = data.translated || text;
        
        // Cache result
        translationCache.set(cacheKey, translated);
        
        // Limit cache size
        if (translationCache.size > 200) {
            const firstKey = translationCache.keys().next().value;
            translationCache.delete(firstKey);
        }
        
        return translated;
    } catch (err) {
        console.error("Translation error:", err);
        return text;
    }
}
