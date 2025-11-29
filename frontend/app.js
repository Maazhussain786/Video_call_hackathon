/**
 * MeetFlow - WebRTC Video Conferencing with Real-time Captions
 * 
 * Features:
 * - Join screen with name, passcode, host/participant roles
 * - WebRTC peer-to-peer video call
 * - Screen sharing with face cam visible
 * - Mic/camera toggle
 * - Real-time speech recognition captions
 * - Instant translation
 */

// ============================================================
// Configuration
// ============================================================
const HOST = "10.7.48.13";  // Your server IP
const API_BASE = `http://${HOST}:8001`;
const WS_BASE = `ws://${HOST}:8001`;

// ============================================================
// State Variables
// ============================================================
let userName = "";
let roomId = "";
let meetingPasscode = "";
let role = "host";
let hostJoined = false;
let isCallActive = false;
let peerName = "";

// WebRTC
let pc = null;
let ws = null;
let localStream = null;
let originalVideoTrack = null;

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

// Translation - optimized for speed
const translationCache = new Map();
let pendingTranslations = new Map();

// ============================================================
// DOM Elements
// ============================================================
const joinScreen = document.getElementById("joinScreen");
const meetingScreen = document.getElementById("meetingScreen");
const userNameInput = document.getElementById("userName");
const meetingIdInput = document.getElementById("meetingId");
const passcodeInput = document.getElementById("passcode");
const hostBtn = document.getElementById("hostBtn");
const participantBtn = document.getElementById("participantBtn");
const joinBtn = document.getElementById("joinBtn");
const joinError = document.getElementById("joinError");

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const faceCamVideo = document.getElementById("faceCamVideo");
const faceCamWrapper = document.getElementById("faceCamWrapper");
const localNameBadge = document.getElementById("localNameBadge");
const remoteNameBadge = document.getElementById("remoteNameBadge");
const localMicStatus = document.getElementById("localMicStatus");
const remoteMicStatus = document.getElementById("remoteMicStatus");
const meetingIdDisplay = document.getElementById("meetingIdDisplay");
const meetingTimer = document.getElementById("meetingTimer");
const participantCount = document.getElementById("participantCount");
const waitingMessage = document.getElementById("waitingMessage");

const micBtn = document.getElementById("micBtn");
const cameraBtn = document.getElementById("cameraBtn");
const screenBtn = document.getElementById("screenBtn");
const leaveBtn = document.getElementById("leaveBtn");
const spokenLangSelect = document.getElementById("spokenLang");
const translateToSelect = document.getElementById("translateTo");

const captionsBody = document.getElementById("captionsBody");
const myCaptionItem = document.getElementById("myCaptionItem");
const peerCaptionItem = document.getElementById("peerCaptionItem");
const myCaptionDiv = document.getElementById("myCaption");
const myTranslationDiv = document.getElementById("myTranslation");
const peerCaptionDiv = document.getElementById("peerCaption");
const peerTranslationDiv = document.getElementById("peerTranslation");
const peerCaptionName = document.getElementById("peerCaptionName");

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
// Join Meeting
// ============================================================
joinBtn.addEventListener("click", async () => {
    userName = userNameInput.value.trim();
    roomId = meetingIdInput.value.trim();
    meetingPasscode = passcodeInput.value.trim();
    
    if (!userName) return showJoinError("Please enter your name");
    if (!roomId) return showJoinError("Please enter a meeting ID");
    if (!meetingPasscode) return showJoinError("Please enter a passcode");
    
    joinBtn.disabled = true;
    joinBtn.textContent = "Connecting...";
    
    try {
        await connectToMeeting();
    } catch (err) {
        showJoinError(err.message || "Failed to connect");
        joinBtn.disabled = false;
        joinBtn.textContent = "Join Meeting";
    }
});

function showJoinError(msg) {
    joinError.textContent = msg;
    joinError.classList.add("show");
    setTimeout(() => joinError.classList.remove("show"), 4000);
}

// ============================================================
// Connect to Meeting
// ============================================================
async function connectToMeeting() {
    // Get media
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
        originalVideoTrack = localStream.getVideoTracks()[0];
    } catch (err) {
        throw new Error(err.name === "NotAllowedError" ? "Camera/mic permission denied" : "Could not access camera/mic");
    }
    
    return new Promise((resolve, reject) => {
        ws = new WebSocket(`${WS_BASE}/ws/${roomId}`);
        
        ws.onopen = () => {
            ws.send(JSON.stringify({
                type: "join",
                name: userName,
                role: role,
                roomId: roomId,
                passcode: meetingPasscode
            }));
        };
        
        ws.onmessage = (e) => handleMessage(JSON.parse(e.data), resolve, reject);
        ws.onerror = () => reject(new Error("Connection failed"));
        ws.onclose = () => {
            if (isCallActive) {
                showToast("Disconnected");
                leaveMeeting();
            }
        };
    });
}

// ============================================================
// WebSocket Message Handler
// ============================================================
async function handleMessage(data, resolve, reject) {
    switch (data.type) {
        case "join-accepted":
            hostJoined = data.isHost || role === "host";
            isCallActive = true;
            showMeetingScreen();
            startMeetingTimer();
            startSpeechRecognition();
            resolve?.();
            showToast(`Joined as ${role}`);
            break;
            
        case "wait-for-host":
            showMeetingScreen();
            waitingMessage.querySelector("p").textContent = "Waiting for host...";
            isCallActive = true;
            resolve?.();
            break;
            
        case "host-joined":
            hostJoined = true;
            waitingMessage.style.display = "none";
            showToast("Host joined");
            startSpeechRecognition();
            break;
            
        case "host-left":
            showToast("Host left the meeting");
            break;
            
        case "peer-joined":
            peerName = data.name || "Participant";
            remoteNameBadge.querySelector("span").textContent = peerName;
            peerCaptionName.textContent = peerName;
            peerCaptionItem.style.display = "block";
            participantCount.textContent = "2";
            waitingMessage.style.display = "none";
            showToast(`${peerName} joined`);
            createPeerConnection();
            await makeOffer();
            break;
            
        case "peer-left":
            showToast(`${data.name || "Peer"} left`);
            participantCount.textContent = "1";
            remoteVideo.srcObject = null;
            remoteNameBadge.querySelector("span").textContent = "Waiting...";
            waitingMessage.style.display = "flex";
            peerCaptionItem.style.display = "none";
            if (pc) { pc.close(); pc = null; }
            break;
            
        case "error":
            reject?.(new Error(data.message));
            showToast(data.message);
            break;
            
        case "offer":
            createPeerConnection();
            await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            ws.send(JSON.stringify({ type: "answer", answer }));
            if (data.senderName) {
                peerName = data.senderName;
                remoteNameBadge.querySelector("span").textContent = peerName;
                peerCaptionName.textContent = peerName;
                peerCaptionItem.style.display = "block";
            }
            break;
            
        case "answer":
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
            break;
            
        case "ice":
            if (pc && data.candidate) {
                try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch {}
            }
            break;
            
        case "caption":
            handlePeerCaption(data);
            break;
    }
}

// ============================================================
// Show Meeting Screen
// ============================================================
function showMeetingScreen() {
    joinScreen.style.display = "none";
    meetingScreen.classList.add("active");
    localNameBadge.querySelector("span").textContent = userName;
    meetingIdDisplay.textContent = roomId;
    joinBtn.disabled = false;
    joinBtn.textContent = "Join Meeting";
}

// ============================================================
// WebRTC Peer Connection
// ============================================================
function createPeerConnection() {
    if (pc) return;
    
    pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });
    
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    
    pc.ontrack = (e) => {
        remoteVideo.srcObject = e.streams[0];
        waitingMessage.style.display = "none";
        participantCount.textContent = "2";
    };
    
    pc.onicecandidate = (e) => {
        if (e.candidate && ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ice", candidate: e.candidate }));
        }
    };
}

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
        const m = Math.floor(elapsed / 60000);
        const s = Math.floor((elapsed % 60000) / 1000);
        meetingTimer.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }, 1000);
}

// ============================================================
// Controls
// ============================================================
micBtn.addEventListener("click", () => {
    isMuted = !isMuted;
    localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
    
    micBtn.className = `control-btn ${isMuted ? 'muted' : 'default'}`;
    micBtn.innerHTML = `<i class="fas fa-microphone${isMuted ? '-slash' : ''}"></i>`;
    localMicStatus.style.display = isMuted ? "inline" : "none";
    showToast(isMuted ? "Muted" : "Unmuted");
});

cameraBtn.addEventListener("click", () => {
    isCameraOff = !isCameraOff;
    localStream.getVideoTracks().forEach(t => t.enabled = !isCameraOff);
    
    cameraBtn.className = `control-btn ${isCameraOff ? 'muted' : 'default'}`;
    cameraBtn.innerHTML = `<i class="fas fa-video${isCameraOff ? '-slash' : ''}"></i>`;
    showToast(isCameraOff ? "Camera off" : "Camera on");
});

// Screen Share with Face Cam
screenBtn.addEventListener("click", async () => {
    if (!isScreenSharing) {
        try {
            screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            const screenTrack = screenStream.getVideoTracks()[0];
            
            // Replace track in peer connection
            const sender = pc?.getSenders().find(s => s.track?.kind === "video");
            if (sender) await sender.replaceTrack(screenTrack);
            
            // Show screen in main local video
            localVideo.srcObject = screenStream;
            
            // Show face cam in small PiP
            faceCamVideo.srcObject = localStream;
            faceCamWrapper.style.display = "block";
            
            screenTrack.onended = () => stopScreenShare();
            
            isScreenSharing = true;
            screenBtn.classList.add("active");
            screenBtn.classList.remove("default");
            showToast("Screen sharing");
        } catch (err) {
            if (err.name !== "NotAllowedError") showToast("Could not share screen");
        }
    } else {
        stopScreenShare();
    }
});

function stopScreenShare() {
    if (!isScreenSharing) return;
    
    screenStream?.getTracks().forEach(t => t.stop());
    screenStream = null;
    
    const sender = pc?.getSenders().find(s => s.track?.kind === "video");
    if (sender && originalVideoTrack) sender.replaceTrack(originalVideoTrack);
    
    localVideo.srcObject = localStream;
    faceCamWrapper.style.display = "none";
    
    isScreenSharing = false;
    screenBtn.classList.remove("active");
    screenBtn.classList.add("default");
    showToast("Screen share stopped");
}

// Leave Meeting
leaveBtn.addEventListener("click", leaveMeeting);

function leaveMeeting() {
    isCallActive = false;
    
    recognition?.stop();
    recognition = null;
    
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    if (pc) { pc.close(); pc = null; }
    if (ws) { ws.close(); ws = null; }
    
    localStream?.getTracks().forEach(t => t.stop());
    screenStream?.getTracks().forEach(t => t.stop());
    localStream = screenStream = null;
    
    localVideo.srcObject = remoteVideo.srcObject = null;
    
    // Reset UI
    isMuted = isCameraOff = isScreenSharing = false;
    micBtn.className = "control-btn default";
    micBtn.innerHTML = '<i class="fas fa-microphone"></i>';
    cameraBtn.className = "control-btn default";
    cameraBtn.innerHTML = '<i class="fas fa-video"></i>';
    screenBtn.className = "control-btn default";
    localMicStatus.style.display = "none";
    faceCamWrapper.style.display = "none";
    
    myCaptionDiv.textContent = "Speak to see captions...";
    myTranslationDiv.textContent = "";
    peerCaptionItem.style.display = "none";
    waitingMessage.style.display = "flex";
    
    meetingScreen.classList.remove("active");
    joinScreen.style.display = "flex";
}

// ============================================================
// Speech Recognition - Optimized for Real-time
// ============================================================
function startSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    
    recognition = new SpeechRecognition();
    recognition.lang = spokenLangSelect.value;
    recognition.continuous = true;
    recognition.interimResults = true;
    
    let lastInterim = "";
    
    recognition.onresult = (e) => {
        let interim = "", final = "";
        
        for (let i = e.resultIndex; i < e.results.length; i++) {
            const t = e.results[i][0].transcript;
            if (e.results[i].isFinal) final += t;
            else interim += t;
        }
        
        // Show interim results immediately (real-time feel)
        if (interim && interim !== lastInterim) {
            myCaptionDiv.textContent = interim;
            myCaptionDiv.style.opacity = "0.7";
            lastInterim = interim;
        }
        
        // Process final results
        if (final) {
            myCaptionDiv.textContent = final;
            myCaptionDiv.style.opacity = "1";
            lastInterim = "";
            
            // Send to peer immediately
            ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify({
                type: "caption",
                text: final,
                sourceLang: spokenLangSelect.value.split("-")[0]
            }));
            
            // Translate in parallel (non-blocking)
            translateAsync(final, "my");
            
            // Scroll captions
            captionsBody.scrollTop = captionsBody.scrollHeight;
        }
    };
    
    recognition.onerror = () => {};
    recognition.onend = () => { if (isCallActive) try { recognition.start(); } catch {} };
    recognition.start();
}

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
function handlePeerCaption(data) {
    peerCaptionDiv.textContent = data.text;
    peerCaptionItem.style.display = "block";
    
    // Translate in parallel
    translateAsync(data.text, "peer", data.sourceLang || "en");
    
    captionsBody.scrollTop = captionsBody.scrollHeight;
}

// ============================================================
// Translation - Optimized for Speed
// ============================================================
async function translateAsync(text, target, sourceLang = null) {
    const src = sourceLang || spokenLangSelect.value.split("-")[0];
    const tgt = translateToSelect.value;
    
    if (src === tgt) {
        if (target === "my") myTranslationDiv.textContent = "";
        else peerTranslationDiv.textContent = "";
        return;
    }
    
    const cacheKey = `${text}|${src}|${tgt}`;
    
    // Check cache first (instant)
    if (translationCache.has(cacheKey)) {
        const translated = translationCache.get(cacheKey);
        if (target === "my") myTranslationDiv.textContent = translated;
        else peerTranslationDiv.textContent = translated;
        return;
    }
    
    // Show loading indicator
    const targetDiv = target === "my" ? myTranslationDiv : peerTranslationDiv;
    targetDiv.textContent = "...";
    
    try {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 4000);
        
        const res = await fetch(`${API_BASE}/translate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, source_lang: src, target_lang: tgt }),
            signal: controller.signal
        });
        
        const data = await res.json();
        const translated = data.translated || text;
        
        // Cache result
        translationCache.set(cacheKey, translated);
        if (translationCache.size > 300) {
            const first = translationCache.keys().next().value;
            translationCache.delete(first);
        }
        
        targetDiv.textContent = translated;
    } catch {
        targetDiv.textContent = "";
    }
}

// ============================================================
// Toast
// ============================================================
function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2500);
}

// ============================================================
// Init
// ============================================================
console.log("MeetFlow initialized | Server:", HOST);
