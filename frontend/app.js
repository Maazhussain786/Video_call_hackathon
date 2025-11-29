/**
 * Video Meet - WebRTC Video Call with Captions & Translation
 * Features:
 * - Join screen with name, passcode, host/participant roles
 * - WebRTC peer-to-peer video call
 * - Screen sharing
 * - Mic/camera toggle
 * - Speech recognition captions
 * - Real-time translation
 */

// ============================================================
// Configuration
// ============================================================
const HOST = "10.7.48.13";  // Change to your server IP
const API_BASE = `http://${HOST}:8001`;
const WS_BASE = `ws://${HOST}:8001`;

// ============================================================
// State Variables
// ============================================================
let userName = "";
let roomId = "";
let meetingPasscode = "";
let role = "host";  // "host" or "participant"
let hostJoined = false;
let isCallActive = false;

// WebRTC
let pc = null;
let ws = null;
let localStream = null;
let originalVideoTrack = null;  // Store original camera track for screen share toggle

// Media states
let isMuted = false;
let isCameraOff = false;
let isScreenSharing = false;
let screenStream = null;

// Speech recognition
let recognition = null;

// Meeting timer
let meetingStartTime = null;
let timerInterval = null;

// Translation cache
const translationCache = new Map();
let translationTimer = null;

// ============================================================
// DOM Elements
// ============================================================
// Join screen
const joinScreen = document.getElementById("joinScreen");
const meetingScreen = document.getElementById("meetingScreen");
const userNameInput = document.getElementById("userName");
const meetingIdInput = document.getElementById("meetingId");
const passcodeInput = document.getElementById("passcode");
const hostBtn = document.getElementById("hostBtn");
const participantBtn = document.getElementById("participantBtn");
const joinBtn = document.getElementById("joinBtn");
const joinError = document.getElementById("joinError");

// Meeting screen
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const localNameBadge = document.getElementById("localNameBadge");
const remoteNameBadge = document.getElementById("remoteNameBadge");
const remoteCaptionName = document.getElementById("remoteCaptionName");
const meetingIdDisplay = document.getElementById("meetingIdDisplay");
const meetingTimer = document.getElementById("meetingTimer");
const participantCount = document.getElementById("participantCount");
const waitingMessage = document.getElementById("waitingMessage");

// Controls
const micBtn = document.getElementById("micBtn");
const cameraBtn = document.getElementById("cameraBtn");
const screenBtn = document.getElementById("screenBtn");
const leaveBtn = document.getElementById("leaveBtn");
const spokenLangSelect = document.getElementById("spokenLang");
const translateToSelect = document.getElementById("translateTo");

// Captions
const myCaptionDiv = document.getElementById("myCaption");
const myTranslationDiv = document.getElementById("myTranslation");
const peerCaptionDiv = document.getElementById("peerCaption");
const peerTranslationDiv = document.getElementById("peerTranslation");

// Toast
const toast = document.getElementById("toast");

// ============================================================
// Role Selection
// ============================================================
hostBtn.addEventListener("click", () => {
    role = "host";
    hostBtn.classList.add("selected");
    participantBtn.classList.remove("selected");
});

participantBtn.addEventListener("click", () => {
    role = "participant";
    participantBtn.classList.add("selected");
    hostBtn.classList.remove("selected");
});

// ============================================================
// Join Button Handler
// ============================================================
joinBtn.addEventListener("click", async () => {
    // Validate inputs
    userName = userNameInput.value.trim();
    roomId = meetingIdInput.value.trim();
    meetingPasscode = passcodeInput.value.trim();
    
    if (!userName) {
        showJoinError("Please enter your name");
        return;
    }
    if (!roomId) {
        showJoinError("Please enter a meeting ID");
        return;
    }
    if (!meetingPasscode) {
        showJoinError("Please enter a passcode");
        return;
    }
    
    joinBtn.disabled = true;
    joinBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Connecting...';
    
    try {
        await connectToMeeting();
    } catch (err) {
        console.error("Connection error:", err);
        showJoinError(err.message || "Failed to connect");
        joinBtn.disabled = false;
        joinBtn.innerHTML = '<i class="fas fa-video"></i> Join Meeting';
    }
});

function showJoinError(message) {
    joinError.textContent = message;
    joinError.classList.add("show");
    setTimeout(() => joinError.classList.remove("show"), 5000);
}

// ============================================================
// Connect to Meeting
// ============================================================
async function connectToMeeting() {
    // Request media first
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ 
            video: true, 
            audio: true 
        });
        localVideo.srcObject = localStream;
        originalVideoTrack = localStream.getVideoTracks()[0];
    } catch (err) {
        if (err.name === "NotAllowedError") {
            throw new Error("Camera/microphone permission denied");
        } else if (err.name === "NotFoundError") {
            throw new Error("No camera or microphone found");
        } else {
            throw new Error("Could not access camera/microphone");
        }
    }
    
    // Connect WebSocket
    return new Promise((resolve, reject) => {
        ws = new WebSocket(`${WS_BASE}/ws/${roomId}`);
        
        ws.onopen = () => {
            // Send join message
            ws.send(JSON.stringify({
                type: "join",
                name: userName,
                role: role,
                roomId: roomId,
                passcode: meetingPasscode
            }));
        };
        
        ws.onmessage = async (event) => {
            const data = JSON.parse(event.data);
            await handleWebSocketMessage(data, resolve, reject);
        };
        
        ws.onerror = () => {
            reject(new Error("WebSocket connection failed"));
        };
        
        ws.onclose = () => {
            if (isCallActive) {
                showToast("Disconnected from meeting");
                leaveMeeting();
            }
        };
    });
}

// ============================================================
// WebSocket Message Handler
// ============================================================
async function handleWebSocketMessage(data, resolve, reject) {
    console.log("Received:", data.type);
    
    switch (data.type) {
        case "join-accepted":
            // Successfully joined
            hostJoined = data.isHost || role === "host";
            isCallActive = true;
            showMeetingScreen();
            startMeetingTimer();
            startSpeechRecognition();
            if (resolve) resolve();
            showToast(`Joined as ${role}`);
            break;
            
        case "wait-for-host":
            // Participant waiting for host
            showMeetingScreen();
            waitingMessage.innerHTML = '<i class="fas fa-user-clock"></i><p>Waiting for host to join...</p>';
            waitingMessage.style.display = "block";
            isCallActive = true;
            if (resolve) resolve();
            break;
            
        case "host-joined":
            // Host has joined, participants can now connect
            hostJoined = true;
            waitingMessage.style.display = "none";
            showToast("Host has joined the meeting");
            startSpeechRecognition();
            break;
            
        case "host-left":
            // Host left the meeting
            hostJoined = false;
            showToast("Host has left the meeting");
            break;
            
        case "peer-joined":
            // Another peer joined
            const peerName = data.name || "Participant";
            remoteNameBadge.textContent = peerName;
            remoteCaptionName.textContent = peerName;
            participantCount.textContent = "2";
            waitingMessage.style.display = "none";
            showToast(`${peerName} joined the meeting`);
            
            // Start WebRTC as caller
            createPeerConnection();
            await makeOffer();
            break;
            
        case "peer-left":
            // Peer left
            showToast(`${data.name || "Participant"} left the meeting`);
            participantCount.textContent = "1";
            remoteVideo.srcObject = null;
            remoteNameBadge.textContent = "Waiting...";
            waitingMessage.style.display = "block";
            waitingMessage.innerHTML = '<i class="fas fa-user-clock"></i><p>Waiting for others to join...</p>';
            
            // Reset peer connection
            if (pc) {
                pc.close();
                pc = null;
            }
            break;
            
        case "error":
            if (reject) reject(new Error(data.message));
            else showToast(data.message);
            break;
            
        case "offer":
            // Received WebRTC offer
            createPeerConnection();
            await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            ws.send(JSON.stringify({ type: "answer", answer }));
            
            if (data.senderName) {
                remoteNameBadge.textContent = data.senderName;
                remoteCaptionName.textContent = data.senderName;
            }
            break;
            
        case "answer":
            // Received WebRTC answer
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
            break;
            
        case "ice":
            // Received ICE candidate
            if (pc && data.candidate) {
                try {
                    await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
                } catch (err) {
                    console.error("ICE error:", err);
                }
            }
            break;
            
        case "caption":
            // Received caption from peer
            handlePeerCaption(data);
            break;
            
        case "announce-name":
            // Peer announced their name
            if (data.senderName) {
                remoteNameBadge.textContent = data.senderName;
                remoteCaptionName.textContent = data.senderName;
            }
            break;
    }
}

// ============================================================
// Show Meeting Screen
// ============================================================
function showMeetingScreen() {
    joinScreen.style.display = "none";
    meetingScreen.classList.add("active");
    
    // Update UI
    localNameBadge.textContent = userName;
    meetingIdDisplay.textContent = roomId;
    participantCount.textContent = "1";
    
    // Reset join button
    joinBtn.disabled = false;
    joinBtn.innerHTML = '<i class="fas fa-video"></i> Join Meeting';
}

// ============================================================
// Create Peer Connection
// ============================================================
function createPeerConnection() {
    if (pc) return;
    
    pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });
    
    // Add local tracks
    localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
    });
    
    // Handle remote track
    pc.ontrack = (event) => {
        remoteVideo.srcObject = event.streams[0];
        waitingMessage.style.display = "none";
        participantCount.textContent = "2";
    };
    
    // Handle ICE candidates
    pc.onicecandidate = (event) => {
        if (event.candidate && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ice", candidate: event.candidate }));
        }
    };
    
    pc.oniceconnectionstatechange = () => {
        console.log("ICE state:", pc.iceConnectionState);
        if (pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed") {
            showToast("Connection lost");
        }
    };
}

// ============================================================
// Make WebRTC Offer
// ============================================================
async function makeOffer() {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    ws.send(JSON.stringify({ type: "offer", offer }));
}

// ============================================================
// Meeting Timer
// ============================================================
function startMeetingTimer() {
    meetingStartTime = Date.now();
    timerInterval = setInterval(() => {
        const elapsed = Date.now() - meetingStartTime;
        const minutes = Math.floor(elapsed / 60000);
        const seconds = Math.floor((elapsed % 60000) / 1000);
        meetingTimer.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }, 1000);
}

// ============================================================
// Control Buttons
// ============================================================

// Microphone Toggle
micBtn.addEventListener("click", () => {
    isMuted = !isMuted;
    
    localStream.getAudioTracks().forEach(track => {
        track.enabled = !isMuted;
    });
    
    if (isMuted) {
        micBtn.classList.add("muted");
        micBtn.classList.remove("default");
        micBtn.innerHTML = '<i class="fas fa-microphone-slash"></i><span class="control-btn-label">Mic</span>';
    } else {
        micBtn.classList.remove("muted");
        micBtn.classList.add("default");
        micBtn.innerHTML = '<i class="fas fa-microphone"></i><span class="control-btn-label">Mic</span>';
    }
    
    showToast(isMuted ? "Microphone muted" : "Microphone unmuted");
});

// Camera Toggle
cameraBtn.addEventListener("click", () => {
    isCameraOff = !isCameraOff;
    
    localStream.getVideoTracks().forEach(track => {
        track.enabled = !isCameraOff;
    });
    
    if (isCameraOff) {
        cameraBtn.classList.add("muted");
        cameraBtn.classList.remove("default");
        cameraBtn.innerHTML = '<i class="fas fa-video-slash"></i><span class="control-btn-label">Camera</span>';
    } else {
        cameraBtn.classList.remove("muted");
        cameraBtn.classList.add("default");
        cameraBtn.innerHTML = '<i class="fas fa-video"></i><span class="control-btn-label">Camera</span>';
    }
    
    showToast(isCameraOff ? "Camera off" : "Camera on");
});

// Screen Share Toggle
screenBtn.addEventListener("click", async () => {
    if (!isScreenSharing) {
        // Start screen sharing
        try {
            screenStream = await navigator.mediaDevices.getDisplayMedia({ 
                video: true, 
                audio: false 
            });
            
            const screenTrack = screenStream.getVideoTracks()[0];
            
            // Replace video track in peer connection
            const sender = pc?.getSenders().find(s => s.track?.kind === "video");
            if (sender) {
                await sender.replaceTrack(screenTrack);
            }
            
            // Show screen in local video
            localVideo.srcObject = screenStream;
            
            // Handle screen share ended (user clicked "Stop sharing" in browser)
            screenTrack.onended = () => {
                stopScreenSharing();
            };
            
            isScreenSharing = true;
            screenBtn.classList.add("active");
            screenBtn.classList.remove("default");
            showToast("Screen sharing started");
            
        } catch (err) {
            console.error("Screen share error:", err);
            if (err.name !== "NotAllowedError") {
                showToast("Could not share screen");
            }
        }
    } else {
        stopScreenSharing();
    }
});

function stopScreenSharing() {
    if (!isScreenSharing) return;
    
    // Stop screen stream
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
    }
    
    // Replace back with camera track
    const sender = pc?.getSenders().find(s => s.track?.kind === "video");
    if (sender && originalVideoTrack) {
        sender.replaceTrack(originalVideoTrack);
    }
    
    // Show camera in local video
    localVideo.srcObject = localStream;
    
    isScreenSharing = false;
    screenBtn.classList.remove("active");
    screenBtn.classList.add("default");
    showToast("Screen sharing stopped");
}

// Leave Meeting
leaveBtn.addEventListener("click", () => {
    leaveMeeting();
});

function leaveMeeting() {
    isCallActive = false;
    hostJoined = false;
    
    // Stop speech recognition
    if (recognition) {
        recognition.stop();
        recognition = null;
    }
    
    // Stop timer
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    
    // Close peer connection
    if (pc) {
        pc.close();
        pc = null;
    }
    
    // Close WebSocket
    if (ws) {
        ws.close();
        ws = null;
    }
    
    // Stop all streams
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
    }
    
    // Clear videos
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
    
    // Reset UI states
    isMuted = false;
    isCameraOff = false;
    isScreenSharing = false;
    micBtn.classList.remove("muted");
    micBtn.classList.add("default");
    micBtn.innerHTML = '<i class="fas fa-microphone"></i><span class="control-btn-label">Mic</span>';
    cameraBtn.classList.remove("muted");
    cameraBtn.classList.add("default");
    cameraBtn.innerHTML = '<i class="fas fa-video"></i><span class="control-btn-label">Camera</span>';
    screenBtn.classList.remove("active");
    screenBtn.classList.add("default");
    
    // Reset captions
    myCaptionDiv.textContent = "-";
    myTranslationDiv.textContent = "";
    peerCaptionDiv.textContent = "-";
    peerTranslationDiv.textContent = "";
    
    // Show join screen
    meetingScreen.classList.remove("active");
    joinScreen.style.display = "flex";
    waitingMessage.style.display = "block";
    
    showToast("Left the meeting");
}

// ============================================================
// Speech Recognition
// ============================================================
function startSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
        console.warn("Speech recognition not supported");
        return;
    }
    
    recognition = new SpeechRecognition();
    recognition.lang = spokenLangSelect.value;
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
        
        if (finalTranscript) {
            myCaptionDiv.textContent = finalTranscript;
            myCaptionDiv.style.opacity = "1";
            
            // Send to peer
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: "caption",
                    text: finalTranscript,
                    sourceLang: spokenLangSelect.value.split("-")[0]
                }));
            }
            
            // Translate
            debouncedTranslate(finalTranscript, "my");
            
        } else if (interimTranscript) {
            myCaptionDiv.textContent = interimTranscript;
            myCaptionDiv.style.opacity = "0.6";
        }
    };
    
    recognition.onerror = (event) => {
        console.error("Speech recognition error:", event.error);
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

// Language change handler
spokenLangSelect.addEventListener("change", () => {
    if (recognition && isCallActive) {
        recognition.stop();
        setTimeout(() => {
            recognition.lang = spokenLangSelect.value;
            recognition.start();
        }, 100);
    }
});

// ============================================================
// Handle Peer Caption
// ============================================================
async function handlePeerCaption(data) {
    peerCaptionDiv.textContent = data.text;
    
    const sourceLang = data.sourceLang || "en";
    const targetLang = translateToSelect.value;
    
    if (sourceLang !== targetLang) {
        peerTranslationDiv.textContent = "translating...";
        const translated = await translateText(data.text, sourceLang, targetLang);
        peerTranslationDiv.textContent = translated;
    } else {
        peerTranslationDiv.textContent = "";
    }
}

// ============================================================
// Translation
// ============================================================
function debouncedTranslate(text, target) {
    clearTimeout(translationTimer);
    translationTimer = setTimeout(async () => {
        const sourceLang = spokenLangSelect.value.split("-")[0];
        const targetLang = translateToSelect.value;
        
        if (sourceLang !== targetLang) {
            const translated = await translateText(text, sourceLang, targetLang);
            if (target === "my") {
                myTranslationDiv.textContent = translated;
            }
        } else {
            myTranslationDiv.textContent = "";
        }
    }, 300);
}

async function translateText(text, sourceLang, targetLang) {
    const cacheKey = `${text}|${sourceLang}|${targetLang}`;
    if (translationCache.has(cacheKey)) {
        return translationCache.get(cacheKey);
    }
    
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        const res = await fetch(`${API_BASE}/translate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, source_lang: sourceLang, target_lang: targetLang }),
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        const data = await res.json();
        const translated = data.translated || text;
        
        translationCache.set(cacheKey, translated);
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

// ============================================================
// Toast Notification
// ============================================================
function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 3000);
}

// ============================================================
// Initialize
// ============================================================
console.log("Video Meet initialized");
console.log("Server:", HOST);
