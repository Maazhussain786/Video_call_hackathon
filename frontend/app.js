/**
 * MeetFlow - WebRTC Video Conferencing
 * 
 * Features:
 * - Host meeting options (initial participant mic/cam state)
 * - Host remote control of participant media
 * - Chat messaging
 * - Auto-scrolling captions with translation
 * - Screen sharing with face cam
 */

// ============================================================
// Configuration
// ============================================================
const HOST = "10.7.48.13";  // Your server IP
const API_BASE = `http://${HOST}:8001`;
const WS_BASE = `ws://${HOST}:8001`;

// ============================================================
// State
// ============================================================
let userName = "";
let roomId = "";
let meetingPasscode = "";
let role = "host";
let isHost = false;
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

// Host options
let participantMicInitiallyMuted = false;
let participantCamInitiallyOff = false;

// Speech recognition
let recognition = null;

// Timer
let meetingStartTime = null;
let timerInterval = null;

// Translation cache
const translationCache = new Map();

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
const hostOptions = document.getElementById("hostOptions");
const optMicMuted = document.getElementById("optMicMuted");
const optCamOff = document.getElementById("optCamOff");

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
const chatToggleBtn = document.getElementById("chatToggleBtn");
const spokenLangSelect = document.getElementById("spokenLang");
const translateToSelect = document.getElementById("translateTo");

// Sidebar
const sidebarTabs = document.querySelectorAll(".sidebar-tab");
const captionsPanel = document.getElementById("captionsPanel");
const chatPanel = document.getElementById("chatPanel");
const captionsList = document.getElementById("captionsList");
const captionInterim = document.getElementById("captionInterim");
const chatMessages = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");
const chatSendBtn = document.getElementById("chatSendBtn");

// Host controls
const hostControlsPanel = document.getElementById("hostControlsPanel");
const ctrlMuteMic = document.getElementById("ctrlMuteMic");
const ctrlUnmuteMic = document.getElementById("ctrlUnmuteMic");
const ctrlDisableCam = document.getElementById("ctrlDisableCam");
const ctrlEnableCam = document.getElementById("ctrlEnableCam");

const toast = document.getElementById("toast");
const hostBanner = document.getElementById("hostBanner");

// ============================================================
// Role Selection
// ============================================================
hostBtn.addEventListener("click", () => {
    role = "host";
    hostBtn.classList.add("selected");
    participantBtn.classList.remove("selected");
    hostOptions.classList.add("show");
});

participantBtn.addEventListener("click", () => {
    role = "participant";
    participantBtn.classList.add("selected");
    hostBtn.classList.remove("selected");
    hostOptions.classList.remove("show");
});

// ============================================================
// Sidebar Tabs
// ============================================================
sidebarTabs.forEach(tab => {
    tab.addEventListener("click", () => {
        sidebarTabs.forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        
        const tabName = tab.dataset.tab;
        captionsPanel.classList.toggle("active", tabName === "captions");
        chatPanel.classList.toggle("active", tabName === "chat");
    });
});

chatToggleBtn.addEventListener("click", () => {
    sidebarTabs.forEach(t => t.classList.remove("active"));
    document.querySelector('[data-tab="chat"]').classList.add("active");
    captionsPanel.classList.remove("active");
    chatPanel.classList.add("active");
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
    
    // Get host options
    participantMicInitiallyMuted = optMicMuted.checked;
    participantCamInitiallyOff = optCamOff.checked;
    
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
            // Send join message with host options
            ws.send(JSON.stringify({
                type: "join",
                name: userName,
                role: role,
                roomId: roomId,
                passcode: meetingPasscode,
                participantMicInitiallyMuted: participantMicInitiallyMuted,
                participantCamInitiallyOff: participantCamInitiallyOff
            }));
        };
        
        ws.onmessage = (e) => handleMessage(JSON.parse(e.data), resolve, reject);
        ws.onerror = () => reject(new Error("Connection failed"));
        ws.onclose = () => { if (isCallActive) { showToast("Disconnected"); leaveMeeting(); } };
    });
}

// ============================================================
// WebSocket Message Handler
// ============================================================
async function handleMessage(data, resolve, reject) {
    switch (data.type) {
        case "join-accepted":
            isHost = data.isHost;
            hostJoined = isHost || role === "host";
            isCallActive = true;
            
            // Apply initial media state for participants
            if (!isHost && data.participantMicInitiallyMuted) {
                applyMute(true);
                showHostBanner("Host has muted your microphone");
            }
            if (!isHost && data.participantCamInitiallyOff) {
                applyCameraOff(true);
                showHostBanner("Host has turned off your camera");
            }
            
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
            
        // --------------------------------------------------------
        // HOST CONTROL - Participant receives control commands
        // --------------------------------------------------------
        case "host-control":
            handleHostControl(data.action);
            break;
            
        // --------------------------------------------------------
        // CHAT - Receive chat messages
        // --------------------------------------------------------
        case "chat":
            addChatMessage(data.from, data.text, data.timestamp, data.from === userName);
            break;
    }
}

// ============================================================
// Host Control Handler (for participants)
// Note: This is for hackathon demo only - not production secure
// ============================================================
function handleHostControl(action) {
    switch (action) {
        case "mute-mic":
            applyMute(true);
            showHostBanner("Host muted your microphone");
            break;
        case "unmute-mic":
            applyMute(false);
            showHostBanner("Host unmuted your microphone");
            break;
        case "disable-camera":
            applyCameraOff(true);
            showHostBanner("Host turned off your camera");
            break;
        case "enable-camera":
            applyCameraOff(false);
            showHostBanner("Host turned on your camera");
            break;
    }
}

function applyMute(muted) {
    isMuted = muted;
    localStream?.getAudioTracks().forEach(t => t.enabled = !muted);
    micBtn.className = `control-btn ${muted ? 'muted' : 'default'}`;
    micBtn.innerHTML = `<i class="fas fa-microphone${muted ? '-slash' : ''}"></i>`;
    localMicStatus.style.display = muted ? "inline" : "none";
}

function applyCameraOff(off) {
    isCameraOff = off;
    localStream?.getVideoTracks().forEach(t => t.enabled = !off);
    cameraBtn.className = `control-btn ${off ? 'muted' : 'default'}`;
    cameraBtn.innerHTML = `<i class="fas fa-video${off ? '-slash' : ''}"></i>`;
}

function showHostBanner(msg) {
    hostBanner.textContent = msg;
    hostBanner.classList.add("show");
    setTimeout(() => hostBanner.classList.remove("show"), 3000);
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
    
    // Show host controls panel only for host
    if (isHost) {
        hostControlsPanel.classList.add("show");
    }
}

// ============================================================
// Host Control Buttons
// ============================================================
ctrlMuteMic.addEventListener("click", () => sendHostControl("mute-mic"));
ctrlUnmuteMic.addEventListener("click", () => sendHostControl("unmute-mic"));
ctrlDisableCam.addEventListener("click", () => sendHostControl("disable-camera"));
ctrlEnableCam.addEventListener("click", () => sendHostControl("enable-camera"));

function sendHostControl(action) {
    if (ws?.readyState === WebSocket.OPEN && isHost) {
        ws.send(JSON.stringify({ type: "host-control", action }));
        showToast(`Sent: ${action.replace('-', ' ')}`);
    }
}

// ============================================================
// WebRTC
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
    applyMute(!isMuted);
    showToast(isMuted ? "Muted" : "Unmuted");
});

cameraBtn.addEventListener("click", () => {
    applyCameraOff(!isCameraOff);
    showToast(isCameraOff ? "Camera off" : "Camera on");
});

screenBtn.addEventListener("click", async () => {
    if (!isScreenSharing) {
        try {
            screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            const screenTrack = screenStream.getVideoTracks()[0];
            
            const sender = pc?.getSenders().find(s => s.track?.kind === "video");
            if (sender) await sender.replaceTrack(screenTrack);
            
            localVideo.srcObject = screenStream;
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
    
    // Reset states
    isMuted = isCameraOff = isScreenSharing = isHost = false;
    micBtn.className = "control-btn default";
    micBtn.innerHTML = '<i class="fas fa-microphone"></i>';
    cameraBtn.className = "control-btn default";
    cameraBtn.innerHTML = '<i class="fas fa-video"></i>';
    screenBtn.className = "control-btn default";
    localMicStatus.style.display = "none";
    faceCamWrapper.style.display = "none";
    hostControlsPanel.classList.remove("show");
    
    // Clear captions and chat
    captionsList.innerHTML = "";
    captionInterim.textContent = "";
    chatMessages.innerHTML = "";
    waitingMessage.style.display = "flex";
    
    meetingScreen.classList.remove("active");
    joinScreen.style.display = "flex";
}

// ============================================================
// Chat
// ============================================================
chatSendBtn.addEventListener("click", sendChat);
chatInput.addEventListener("keypress", (e) => { if (e.key === "Enter") sendChat(); });

function sendChat() {
    const text = chatInput.value.trim();
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
    
    ws.send(JSON.stringify({
        type: "chat",
        from: userName,
        text: text,
        timestamp: Date.now()
    }));
    
    chatInput.value = "";
}

function addChatMessage(from, text, timestamp, isMine) {
    const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    const msg = document.createElement("div");
    msg.className = `chat-msg ${isMine ? 'mine' : ''}`;
    msg.innerHTML = `
        <div class="chat-msg-header">
            <span class="chat-msg-name">${from}</span>
            <span class="chat-msg-time">${time}</span>
        </div>
        <div class="chat-msg-text">${escapeHtml(text)}</div>
    `;
    
    chatMessages.appendChild(msg);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

// ============================================================
// Speech Recognition - Auto-scrolling captions
// ============================================================
function startSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    
    recognition = new SpeechRecognition();
    recognition.lang = spokenLangSelect.value;
    recognition.continuous = true;
    recognition.interimResults = true;
    
    recognition.onresult = (e) => {
        let interim = "", final = "";
        
        for (let i = e.resultIndex; i < e.results.length; i++) {
            const t = e.results[i][0].transcript;
            if (e.results[i].isFinal) final += t;
            else interim += t;
        }
        
        // Show interim results
        if (interim) {
            captionInterim.textContent = interim;
            captionInterim.style.display = "block";
        }
        
        // Process final results
        if (final) {
            captionInterim.style.display = "none";
            captionInterim.textContent = "";
            
            // Send to peer
            ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify({
                type: "caption",
                text: final,
                sourceLang: spokenLangSelect.value.split("-")[0]
            }));
            
            // Add caption line with translation
            addCaptionLine(final, userName, true);
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
// Captions - Auto-scrolling list
// ============================================================
async function addCaptionLine(original, speaker, isMine) {
    const sourceLang = spokenLangSelect.value.split("-")[0];
    const targetLang = translateToSelect.value;
    
    const line = document.createElement("div");
    line.className = `caption-line ${isMine ? 'mine' : 'peer'}`;
    line.innerHTML = `
        <div class="caption-speaker">${speaker}</div>
        <div class="caption-original">${escapeHtml(original)}</div>
        <div class="caption-translated"></div>
    `;
    
    captionsList.appendChild(line);
    captionsList.scrollTop = captionsList.scrollHeight;
    
    // Translate if needed
    if (sourceLang !== targetLang) {
        const translatedDiv = line.querySelector(".caption-translated");
        translatedDiv.textContent = "...";
        
        const translated = await translateText(original, sourceLang, targetLang);
        translatedDiv.textContent = translated;
    }
}

function handlePeerCaption(data) {
    addCaptionLine(data.text, data.senderName || peerName || "Peer", false);
}

// ============================================================
// Translation
// ============================================================
async function translateText(text, sourceLang, targetLang) {
    const cacheKey = `${text}|${sourceLang}|${targetLang}`;
    if (translationCache.has(cacheKey)) return translationCache.get(cacheKey);
    
    try {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 4000);
        
        const res = await fetch(`${API_BASE}/translate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, source_lang: sourceLang, target_lang: targetLang }),
            signal: controller.signal
        });
        
        const data = await res.json();
        const translated = data.translated || text;
        
        translationCache.set(cacheKey, translated);
        if (translationCache.size > 300) {
            translationCache.delete(translationCache.keys().next().value);
        }
        
        return translated;
    } catch {
        return text;
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
