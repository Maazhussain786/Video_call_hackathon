/**
 * MeetFlow - Video Conferencing with YouTube-style Captions
 */

const HOST = "10.7.48.13";
const API_BASE = `http://${HOST}:8001`;
const WS_BASE = `ws://${HOST}:8001`;

// State
let userName = "", roomId = "", meetingPasscode = "", role = "host";
let isHost = false, hostJoined = false, isCallActive = false, peerName = "";
let captionsEnabled = true;

// WebRTC
let pc = null, ws = null, localStream = null, originalVideoTrack = null;

// Media
let isMuted = false, isCameraOff = false, isScreenSharing = false, screenStream = null;

// Host options
let participantMicInitiallyMuted = false, participantCamInitiallyOff = false;

// Speech
let recognition = null;

// Timer
let meetingStartTime = null, timerInterval = null;

// Translation
const translationCache = new Map();
let captionTimeout = null;

// DOM Elements
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
const meetingIdDisplay = document.getElementById("meetingIdDisplay");
const meetingTimer = document.getElementById("meetingTimer");
const participantCount = document.getElementById("participantCount");
const waitingMessage = document.getElementById("waitingMessage");

const micBtn = document.getElementById("micBtn");
const cameraBtn = document.getElementById("cameraBtn");
const screenBtn = document.getElementById("screenBtn");
const captionsBtn = document.getElementById("captionsBtn");
const sidebarBtn = document.getElementById("sidebarBtn");
const leaveBtn = document.getElementById("leaveBtn");

// Language selects (both video overlay and sidebar)
const spokenLang = document.getElementById("spokenLang");
const translateTo = document.getElementById("translateTo");
const spokenLangSidebar = document.getElementById("spokenLangSidebar");
const translateToSidebar = document.getElementById("translateToSidebar");

// Captions
const captionsOverlay = document.getElementById("captionsOverlay");
const captionDisplay = document.getElementById("captionDisplay");
const captionInterim = document.getElementById("captionInterim");
const captionsHistory = document.getElementById("captionsHistory");

// Sidebar
const sidebar = document.getElementById("sidebar");
const sidebarTabs = document.querySelectorAll(".sidebar-tab");
const captionsHistoryPanel = document.getElementById("captionsHistoryPanel");
const chatPanel = document.getElementById("chatPanel");

// Chat
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

// Sync language selectors
function syncLangSelectors(source, target) {
    target.value = source.value;
}
spokenLang.addEventListener("change", () => { syncLangSelectors(spokenLang, spokenLangSidebar); updateRecognitionLang(); });
spokenLangSidebar.addEventListener("change", () => { syncLangSelectors(spokenLangSidebar, spokenLang); updateRecognitionLang(); });
translateTo.addEventListener("change", () => syncLangSelectors(translateTo, translateToSidebar));
translateToSidebar.addEventListener("change", () => syncLangSelectors(translateToSidebar, translateTo));

function updateRecognitionLang() {
    if (recognition && isCallActive) {
        recognition.stop();
        setTimeout(() => { recognition.lang = spokenLang.value; recognition.start(); }, 100);
    }
}

// Role Selection
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

// Sidebar Tabs
sidebarTabs.forEach(tab => {
    tab.addEventListener("click", () => {
        sidebarTabs.forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        const tabName = tab.dataset.tab;
        captionsHistoryPanel.classList.toggle("active", tabName === "captions");
        chatPanel.classList.toggle("active", tabName === "chat");
    });
});

// Join
joinBtn.addEventListener("click", async () => {
    userName = userNameInput.value.trim();
    roomId = meetingIdInput.value.trim();
    meetingPasscode = passcodeInput.value.trim();
    
    if (!userName) return showJoinError("Please enter your name");
    if (!roomId) return showJoinError("Please enter a meeting ID");
    if (!meetingPasscode) return showJoinError("Please enter a passcode");
    
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

// Connect
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
            ws.send(JSON.stringify({
                type: "join", name: userName, role, roomId, passcode: meetingPasscode,
                participantMicInitiallyMuted, participantCamInitiallyOff
            }));
        };
        ws.onmessage = (e) => handleMessage(JSON.parse(e.data), resolve, reject);
        ws.onerror = () => reject(new Error("Connection failed"));
        ws.onclose = () => { if (isCallActive) { showToast("Disconnected"); leaveMeeting(); } };
    });
}

// Message Handler
async function handleMessage(data, resolve, reject) {
    switch (data.type) {
        case "join-accepted":
            isHost = data.isHost;
            hostJoined = isHost || role === "host";
            isCallActive = true;
            if (!isHost && data.participantMicInitiallyMuted) { applyMute(true); showHostBanner("Host muted your mic"); }
            if (!isHost && data.participantCamInitiallyOff) { applyCameraOff(true); showHostBanner("Host turned off your camera"); }
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
        case "host-left": showToast("Host left"); break;
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
        case "error": reject?.(new Error(data.message)); showToast(data.message); break;
        case "offer":
            createPeerConnection();
            await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            ws.send(JSON.stringify({ type: "answer", answer }));
            if (data.senderName) { peerName = data.senderName; remoteNameBadge.querySelector("span").textContent = peerName; }
            break;
        case "answer": await pc.setRemoteDescription(new RTCSessionDescription(data.answer)); break;
        case "ice": if (pc && data.candidate) try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch {} break;
        case "caption": showPeerCaption(data); break;
        case "host-control": handleHostControl(data.action); break;
        case "chat": addChatMessage(data.from, data.text, data.timestamp, data.from === userName); break;
    }
}

// Host Control
function handleHostControl(action) {
    switch (action) {
        case "mute-mic": applyMute(true); showHostBanner("Host muted your mic"); break;
        case "unmute-mic": applyMute(false); showHostBanner("Host unmuted your mic"); break;
        case "disable-camera": applyCameraOff(true); showHostBanner("Host turned off camera"); break;
        case "enable-camera": applyCameraOff(false); showHostBanner("Host turned on camera"); break;
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

// Meeting Screen
function showMeetingScreen() {
    joinScreen.style.display = "none";
    meetingScreen.classList.add("active");
    localNameBadge.querySelector("span").textContent = userName;
    meetingIdDisplay.textContent = roomId;
    joinBtn.disabled = false;
    joinBtn.textContent = "Join Meeting";
    if (isHost) hostControlsPanel.classList.add("show");
}

// Host control buttons
ctrlMuteMic.addEventListener("click", () => sendHostControl("mute-mic"));
ctrlUnmuteMic.addEventListener("click", () => sendHostControl("unmute-mic"));
ctrlDisableCam.addEventListener("click", () => sendHostControl("disable-camera"));
ctrlEnableCam.addEventListener("click", () => sendHostControl("enable-camera"));

function sendHostControl(action) {
    if (ws?.readyState === WebSocket.OPEN && isHost) {
        ws.send(JSON.stringify({ type: "host-control", action }));
        showToast(`Sent: ${action.replace(/-/g, ' ')}`);
    }
}

// WebRTC
function createPeerConnection() {
    if (pc) return;
    pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    pc.ontrack = (e) => { remoteVideo.srcObject = e.streams[0]; waitingMessage.style.display = "none"; participantCount.textContent = "2"; };
    pc.onicecandidate = (e) => { if (e.candidate && ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ice", candidate: e.candidate })); };
}

async function makeOffer() {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    ws.send(JSON.stringify({ type: "offer", offer }));
}

// Timer
function startMeetingTimer() {
    meetingStartTime = Date.now();
    timerInterval = setInterval(() => {
        const elapsed = Date.now() - meetingStartTime;
        meetingTimer.textContent = `${String(Math.floor(elapsed / 60000)).padStart(2, '0')}:${String(Math.floor((elapsed % 60000) / 1000)).padStart(2, '0')}`;
    }, 1000);
}

// Controls
micBtn.addEventListener("click", () => { applyMute(!isMuted); showToast(isMuted ? "Muted" : "Unmuted"); });
cameraBtn.addEventListener("click", () => { applyCameraOff(!isCameraOff); showToast(isCameraOff ? "Camera off" : "Camera on"); });

captionsBtn.addEventListener("click", () => {
    captionsEnabled = !captionsEnabled;
    captionsOverlay.style.display = captionsEnabled ? "block" : "none";
    captionsBtn.classList.toggle("active", captionsEnabled);
    showToast(captionsEnabled ? "Captions on" : "Captions off");
});

sidebarBtn.addEventListener("click", () => {
    sidebar.style.display = sidebar.style.display === "none" ? "flex" : "none";
    sidebarBtn.classList.toggle("active");
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
            showToast("Screen sharing");
        } catch (err) { if (err.name !== "NotAllowedError") showToast("Could not share screen"); }
    } else { stopScreenShare(); }
});

function stopScreenShare() {
    if (!isScreenSharing) return;
    screenStream?.getTracks().forEach(t => t.stop());
    const sender = pc?.getSenders().find(s => s.track?.kind === "video");
    if (sender && originalVideoTrack) sender.replaceTrack(originalVideoTrack);
    localVideo.srcObject = localStream;
    faceCamWrapper.style.display = "none";
    isScreenSharing = false;
    screenBtn.classList.remove("active");
    showToast("Screen share stopped");
}

leaveBtn.addEventListener("click", leaveMeeting);

function leaveMeeting() {
    isCallActive = false;
    recognition?.stop(); recognition = null;
    if (timerInterval) clearInterval(timerInterval);
    if (pc) { pc.close(); pc = null; }
    if (ws) { ws.close(); ws = null; }
    localStream?.getTracks().forEach(t => t.stop());
    screenStream?.getTracks().forEach(t => t.stop());
    localStream = screenStream = null;
    localVideo.srcObject = remoteVideo.srcObject = null;
    
    isMuted = isCameraOff = isScreenSharing = isHost = false;
    micBtn.className = "control-btn default";
    micBtn.innerHTML = '<i class="fas fa-microphone"></i>';
    cameraBtn.className = "control-btn default";
    cameraBtn.innerHTML = '<i class="fas fa-video"></i>';
    screenBtn.classList.remove("active");
    captionsBtn.classList.remove("active");
    localMicStatus.style.display = "none";
    faceCamWrapper.style.display = "none";
    hostControlsPanel.classList.remove("show");
    captionDisplay.innerHTML = "";
    captionsHistory.innerHTML = "";
    chatMessages.innerHTML = "";
    waitingMessage.style.display = "flex";
    
    meetingScreen.classList.remove("active");
    joinScreen.style.display = "flex";
}

// Chat
chatSendBtn.addEventListener("click", sendChat);
chatInput.addEventListener("keypress", (e) => { if (e.key === "Enter") sendChat(); });

function sendChat() {
    const text = chatInput.value.trim();
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "chat", from: userName, text, timestamp: Date.now() }));
    chatInput.value = "";
}

function addChatMessage(from, text, timestamp, isMine) {
    const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const msg = document.createElement("div");
    msg.className = `chat-msg ${isMine ? 'mine' : ''}`;
    msg.innerHTML = `<div class="chat-msg-header"><span class="chat-msg-name">${esc(from)}</span><span class="chat-msg-time">${time}</span></div><div class="chat-msg-text">${esc(text)}</div>`;
    chatMessages.appendChild(msg);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function esc(t) { const d = document.createElement("div"); d.textContent = t; return d.innerHTML; }

// Speech Recognition
function startSpeechRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    
    recognition = new SR();
    recognition.lang = spokenLang.value;
    recognition.continuous = true;
    recognition.interimResults = true;
    
    recognition.onresult = (e) => {
        let interim = "", final = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
            const t = e.results[i][0].transcript;
            if (e.results[i].isFinal) final += t;
            else interim += t;
        }
        
        if (interim && captionsEnabled) {
            captionInterim.textContent = interim;
            captionInterim.style.display = "inline";
        }
        
        if (final) {
            captionInterim.style.display = "none";
            ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify({
                type: "caption", text: final, sourceLang: spokenLang.value.split("-")[0]
            }));
            showCaption(final, userName, true);
        }
    };
    
    recognition.onerror = () => {};
    recognition.onend = () => { if (isCallActive) try { recognition.start(); } catch {} };
    recognition.start();
}

// YouTube-style Caption Overlay
async function showCaption(text, speaker, isMine) {
    if (!captionsEnabled) return;
    
    const srcLang = spokenLang.value.split("-")[0];
    const tgtLang = translateTo.value;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    // Show on video (YouTube style)
    captionDisplay.innerHTML = `
        <div class="caption-line">
            <span class="caption-text-wrapper">${esc(text)}</span>
        </div>
        <div class="caption-translation" id="captionTranslation">
            <span class="caption-text-wrapper">...</span>
        </div>
    `;
    
    // Add to history sidebar
    const historyItem = document.createElement("div");
    historyItem.className = `caption-history-item ${isMine ? '' : 'peer'}`;
    historyItem.innerHTML = `
        <div class="caption-history-header">
            <span class="caption-history-speaker">${esc(speaker)}</span>
            <span class="caption-history-time">${time}</span>
        </div>
        <div class="caption-history-original">${esc(text)}</div>
        <div class="caption-history-translated">...</div>
    `;
    captionsHistory.appendChild(historyItem);
    captionsHistory.scrollTop = captionsHistory.scrollHeight;
    
    // Translate
    if (srcLang !== tgtLang) {
        const translated = await translateText(text, srcLang, tgtLang);
        
        // Update video caption
        const transEl = document.getElementById("captionTranslation");
        if (transEl) transEl.innerHTML = `<span class="caption-text-wrapper">${esc(translated)}</span>`;
        
        // Update history
        historyItem.querySelector(".caption-history-translated").textContent = translated;
    } else {
        document.getElementById("captionTranslation")?.remove();
        historyItem.querySelector(".caption-history-translated").style.display = "none";
    }
    
    // Auto-hide video caption after 6 seconds
    clearTimeout(captionTimeout);
    captionTimeout = setTimeout(() => { captionDisplay.innerHTML = ""; }, 6000);
}

function showPeerCaption(data) {
    showCaption(data.text, data.senderName || peerName || "Peer", false);
}

// Translation
async function translateText(text, src, tgt) {
    const key = `${text}|${src}|${tgt}`;
    if (translationCache.has(key)) return translationCache.get(key);
    
    try {
        const ctrl = new AbortController();
        setTimeout(() => ctrl.abort(), 5000);
        const res = await fetch(`${API_BASE}/translate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, source_lang: src, target_lang: tgt }),
            signal: ctrl.signal
        });
        const data = await res.json();
        const translated = data.translated || text;
        translationCache.set(key, translated);
        if (translationCache.size > 300) translationCache.delete(translationCache.keys().next().value);
        return translated;
    } catch { return text; }
}

// Toast
function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2500);
}

console.log("MeetFlow | Server:", HOST);
