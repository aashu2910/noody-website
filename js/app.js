// Main app: presence ("who's live") + 1-to-1 WebRTC video calls.
// Firestore is only used to pass small "signalling" messages between
// the two browsers; the actual video goes directly browser-to-browser.
import { ready, auth, db, toast, showUnavailable } from "./firebase.js";
import { iceServers } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, setDoc, updateDoc, getDoc, addDoc, collection, query, where,
  onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

const HEARTBEAT_MS = 20000;   // how often we tell Firestore "I'm still here"
const STALE_MS = 90000;       // someone silent for longer than this is treated as offline
const RING_TIMEOUT_MS = 35000; // stop ringing after this long

let me = null;
let heartbeat = null;
const liveUsers = new Map(); // uid -> user doc data
let call = null;            // the active call (only one at a time)
let pendingIncoming = null; // { id, data } shown in the incoming modal
let ringer = null;

// ---------------------------------------------------------------- start
if (!ready) {
  showUnavailable();
} else {
  onAuthStateChanged(auth, async (user) => {
    if (!user) return location.replace("index.html");
    me = {
      uid: user.uid,
      name: user.displayName || (user.email || "Guest").split("@")[0],
      photo: user.photoURL || null
    };
    $("myName").textContent = me.name;
    paintAvatar($("myAvatar"), me.name, me.photo);
    try { await goLive(); } catch (err) { console.error(err); return showUnavailable(); }
    watchLiveUsers();
    watchIncomingCalls();
  });
}

// ---------------------------------------------------------------- presence
function myRef() { return doc(db, "users", me.uid); }

async function goLive() {
  await setDoc(myRef(), {
    name: me.name,
    photo: me.photo,
    online: true,
    inCall: false,
    lastSeen: serverTimestamp()
  }, { merge: true });
  clearInterval(heartbeat);
  heartbeat = setInterval(beat, HEARTBEAT_MS);
}

function beat() {
  if (!me) return;
  updateDoc(myRef(), { online: true, lastSeen: serverTimestamp() }).catch(() => {});
}

function setInCall(on) {
  if (me) updateDoc(myRef(), { inCall: on, lastSeen: serverTimestamp() }).catch(() => {});
}

// When the tab comes back into view, refresh right away (browsers slow timers in hidden tabs)
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") beat();
});

// Best effort "I'm leaving" when the tab closes. If it doesn't get through,
// the 90-second staleness check hides us anyway.
window.addEventListener("pagehide", () => {
  if (!me) return;
  if (call) updateDoc(call.ref, { status: "ended" }).catch(() => {});
  updateDoc(myRef(), { online: false, inCall: false }).catch(() => {});
});

function watchLiveUsers() {
  const q = query(collection(db, "users"), where("online", "==", true));
  onSnapshot(q, (snap) => {
    liveUsers.clear();
    snap.forEach((d) => { if (d.id !== me.uid) liveUsers.set(d.id, d.data()); });
    renderUsers();
  }, (err) => { console.error(err); showUnavailable(); });
  setInterval(renderUsers, 15000); // re-check staleness
}

function isFresh(u) {
  const t = u.lastSeen && u.lastSeen.toMillis ? u.lastSeen.toMillis() : 0;
  return Date.now() - t < STALE_MS;
}

function renderUsers() {
  const list = $("userList");
  list.textContent = "";
  const people = [...liveUsers.entries()]
    .filter(([, u]) => isFresh(u))
    .sort((a, b) => (a[1].name || "").localeCompare(b[1].name || ""));

  $("liveCount").textContent = `${people.length} online`;
  $("emptyState").hidden = people.length > 0;

  for (const [uid, u] of people) {
    const li = document.createElement("li");
    li.className = "user";

    const av = document.createElement("span");
    av.className = "avatar";
    paintAvatar(av, u.name, u.photo);

    const info = document.createElement("div");
    info.className = "user-info";
    const nm = document.createElement("span");
    nm.className = "user-name";
    nm.textContent = u.name || "Someone";
    const st = document.createElement("span");
    st.className = "user-state" + (u.inCall ? " busy" : "");
    st.textContent = u.inCall ? "In a call" : "Live now";
    info.append(nm, st);

    const btn = document.createElement("button");
    btn.className = "btn btn-primary btn-sm";
    btn.type = "button";
    btn.textContent = "Call";
    btn.disabled = !!u.inCall || !!call;
    btn.addEventListener("click", () => startCall(uid, u.name || "Someone", u.photo || null));

    li.append(av, info, btn);
    list.appendChild(li);
  }
}

// ---------------------------------------------------------------- media + peer connection
async function getMedia() {
  try {
    return await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch (e1) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      toast("No camera available — joining with audio only.");
      return s;
    } catch (e2) {
      toast("Allow camera/microphone access in your browser to make calls.", "error");
      return null;
    }
  }
}

function createPeer(localStream) {
  const pc = new RTCPeerConnection({ iceServers });
  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

  const remoteStream = new MediaStream();
  $("remoteVideo").srcObject = remoteStream;
  pc.ontrack = (e) => {
    e.streams[0].getTracks().forEach((t) => remoteStream.addTrack(t));
    if (e.track.kind === "video") $("remotePlaceholder").hidden = true;
  };

  pc.onconnectionstatechange = () => {
    if (!call || call.pc !== pc) return;
    const s = pc.connectionState;
    if (s === "connected") {
      clearTimeout(call.timeout);
      startTimer();
    } else if (s === "disconnected") {
      setStatus("Reconnecting…");
    } else if (s === "failed") {
      endCall(true, "Couldn't connect the call. Please try again, or try another network.");
    }
  };
  return pc;
}

// ICE candidates can arrive before the remote description is set; queue them until it is.
function candidateAdder(pc) {
  const queue = [];
  const add = (c) => pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
  return {
    push(c) { pc.remoteDescription ? add(c) : queue.push(c); },
    flush() { while (queue.length) add(queue.shift()); }
  };
}

// ---------------------------------------------------------------- outgoing call
async function startCall(peerId, peerName, peerPhoto) {
  if (call) return;
  const localStream = await getMedia();
  if (!localStream) return;

  const ref = doc(collection(db, "calls"));
  const pc = createPeer(localStream);
  const cands = candidateAdder(pc);
  call = { id: ref.id, ref, pc, localStream, role: "caller", peerName, unsubs: [], timeout: null };

  openCallScreen(peerName, peerPhoto, "Calling…");
  setInCall(true);
  renderUsers();

  pc.onicecandidate = (e) => {
    if (e.candidate) addDoc(collection(ref, "offerCandidates"), e.candidate.toJSON()).catch(() => {});
  };

  try {
    const offer = await pc.createOffer();
    await setDoc(ref, {
      from: me.uid, fromName: me.name, fromPhoto: me.photo,
      to: peerId, toName: peerName,
      status: "ringing",
      offer: { type: offer.type, sdp: offer.sdp },
      createdAt: serverTimestamp()
    });
    await pc.setLocalDescription(offer);
  } catch (err) {
    console.error(err);
    return endCall(false, "Couldn't start the call. Please try again.");
  }

  call.unsubs.push(onSnapshot(ref, (snap) => {
    const d = snap.data();
    if (!d || !call || call.id !== ref.id) return;
    if (d.answer && !pc.currentRemoteDescription) {
      pc.setRemoteDescription(new RTCSessionDescription(d.answer)).then(() => cands.flush()).catch(() => {});
      setStatus("Connecting…");
    }
    const endings = { declined: `${peerName} declined the call`, busy: `${peerName} is in another call`, ended: "Call ended", missed: "No answer" };
    if (endings[d.status]) endCall(false, endings[d.status]);
  }));

  call.unsubs.push(onSnapshot(collection(ref, "answerCandidates"), (snap) => {
    snap.docChanges().forEach((ch) => { if (ch.type === "added") cands.push(ch.doc.data()); });
  }));

  call.timeout = setTimeout(() => {
    if (call && call.id === ref.id && !pc.currentRemoteDescription) {
      updateDoc(ref, { status: "missed" }).catch(() => {});
      endCall(false, `${peerName} didn't answer`);
    }
  }, RING_TIMEOUT_MS);
}

// ---------------------------------------------------------------- incoming call
function watchIncomingCalls() {
  const q = query(collection(db, "calls"), where("to", "==", me.uid), where("status", "==", "ringing"));
  onSnapshot(q, (snap) => {
    snap.docChanges().forEach((ch) => {
      const data = ch.doc.data();
      if (ch.type === "added") {
        const created = data.createdAt && data.createdAt.toMillis ? data.createdAt.toMillis() : Date.now();
        if (Date.now() - created > RING_TIMEOUT_MS + 10000) return; // old leftover call
        if (call || pendingIncoming) {
          updateDoc(ch.doc.ref, { status: "busy" }).catch(() => {});
          return;
        }
        showIncoming(ch.doc.id, data);
      }
      if (ch.type === "removed" && pendingIncoming && pendingIncoming.id === ch.doc.id) {
        // Caller hung up before we answered (or we answered — hideIncoming is harmless then)
        if (!call) toast(`Missed call from ${pendingIncoming.data.fromName || "someone"}`);
        hideIncoming();
      }
    });
  }, (err) => { console.error(err); showUnavailable(); });
}

function showIncoming(id, data) {
  pendingIncoming = { id, data };
  $("incomingName").textContent = data.fromName || "Someone";
  paintAvatar($("incomingAvatar"), data.fromName, data.fromPhoto);
  $("incoming").hidden = false;
  startRinging();
}

function hideIncoming() {
  pendingIncoming = null;
  $("incoming").hidden = true;
  stopRinging();
}

$("declineBtn").addEventListener("click", () => {
  if (!pendingIncoming) return;
  updateDoc(doc(db, "calls", pendingIncoming.id), { status: "declined" }).catch(() => {});
  hideIncoming();
});

$("acceptBtn").addEventListener("click", async () => {
  if (!pendingIncoming || call) return;
  const { id, data } = pendingIncoming;
  hideIncoming();
  const ref = doc(db, "calls", id);

  const fresh = await getDoc(ref);
  if (!fresh.exists() || fresh.data().status !== "ringing") return toast("That call has already ended.");

  const localStream = await getMedia();
  if (!localStream) {
    updateDoc(ref, { status: "declined" }).catch(() => {});
    return;
  }

  const pc = createPeer(localStream);
  const cands = candidateAdder(pc);
  call = { id, ref, pc, localStream, role: "callee", peerName: data.fromName, unsubs: [], timeout: null };

  openCallScreen(data.fromName || "Someone", data.fromPhoto || null, "Connecting…");
  setInCall(true);
  renderUsers();

  pc.onicecandidate = (e) => {
    if (e.candidate) addDoc(collection(ref, "answerCandidates"), e.candidate.toJSON()).catch(() => {});
  };

  try {
    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
    cands.flush();
    const answer = await pc.createAnswer();
    await updateDoc(ref, { answer: { type: answer.type, sdp: answer.sdp }, status: "accepted" });
    await pc.setLocalDescription(answer);
  } catch (err) {
    console.error(err);
    return endCall(true, "Couldn't connect the call. Please try again.");
  }

  call.unsubs.push(onSnapshot(collection(ref, "offerCandidates"), (snap) => {
    snap.docChanges().forEach((ch) => { if (ch.type === "added") cands.push(ch.doc.data()); });
  }));
  call.unsubs.push(onSnapshot(ref, (snap) => {
    const d = snap.data();
    if (d && d.status === "ended" && call && call.id === id) endCall(false, "Call ended");
  }));
});

// ---------------------------------------------------------------- end call
function endCall(notifyOther, message) {
  if (!call) return;
  const c = call;
  call = null;
  clearTimeout(c.timeout);
  c.unsubs.forEach((u) => u());
  if (notifyOther) updateDoc(c.ref, { status: "ended" }).catch(() => {});
  try { c.pc.close(); } catch (_) {}
  c.localStream.getTracks().forEach((t) => t.stop());
  closeCallScreen();
  setInCall(false);
  renderUsers();
  if (message) toast(message);
}

$("hangupBtn").addEventListener("click", () => endCall(true, "Call ended"));

// ---------------------------------------------------------------- call screen UI
let timerId = null;

function openCallScreen(peerName, peerPhoto, status) {
  $("callPeer").textContent = peerName;
  paintAvatar($("peerAvatar"), peerName, peerPhoto);
  $("remotePlaceholder").hidden = false;
  $("localVideo").srcObject = call.localStream;
  setStatus(status);
  resetToggles();
  $("callScreen").hidden = false;
  document.body.classList.add("in-call");
}

function closeCallScreen() {
  clearInterval(timerId);
  timerId = null;
  $("callScreen").hidden = true;
  $("remoteVideo").srcObject = null;
  $("localVideo").srcObject = null;
  document.body.classList.remove("in-call");
}

function setStatus(text) { $("callStatus").textContent = text; }

function startTimer() {
  if (timerId) return;
  const t0 = Date.now();
  const tick = () => {
    const s = Math.floor((Date.now() - t0) / 1000);
    setStatus(`${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`);
  };
  tick();
  timerId = setInterval(tick, 1000);
}

function resetToggles() {
  ["micBtn", "camBtn"].forEach((id) => {
    $(id).classList.remove("off");
    $(id).setAttribute("aria-pressed", "false");
  });
}

function toggleTrack(kind, btnId, onTitle, offTitle) {
  if (!call) return;
  const tracks = kind === "audio" ? call.localStream.getAudioTracks() : call.localStream.getVideoTracks();
  if (!tracks.length) return toast(kind === "audio" ? "No microphone in this call." : "No camera in this call.");
  const enabled = !tracks[0].enabled;
  tracks.forEach((t) => (t.enabled = enabled));
  const btn = $(btnId);
  btn.classList.toggle("off", !enabled);
  btn.setAttribute("aria-pressed", String(!enabled));
  btn.title = enabled ? onTitle : offTitle;
}

$("micBtn").addEventListener("click", () => toggleTrack("audio", "micBtn", "Mute microphone", "Unmute microphone"));
$("camBtn").addEventListener("click", () => toggleTrack("video", "camBtn", "Turn camera off", "Turn camera on"));

// ---------------------------------------------------------------- ringtone (simple two-tone beep)
function startRinging() {
  stopRinging();
  document.title = "📞 Incoming call — noody live";
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const ring = () => {
      [0, 0.25].forEach((offset) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = offset ? 660 : 880;
        g.gain.setValueAtTime(0.0001, ctx.currentTime + offset);
        g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + offset + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + 0.22);
        o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + offset);
        o.stop(ctx.currentTime + offset + 0.24);
      });
    };
    ring();
    ringer = { ctx, id: setInterval(ring, 1600) };
  } catch (_) { /* audio blocked — the popup still shows */ }
}

function stopRinging() {
  document.title = "noody live";
  if (!ringer) return;
  clearInterval(ringer.id);
  ringer.ctx.close().catch(() => {});
  ringer = null;
}

// ---------------------------------------------------------------- misc
function paintAvatar(el, name, photo) {
  el.textContent = "";
  el.style.backgroundImage = "";
  if (photo) {
    el.style.backgroundImage = `url("${String(photo).replace(/"/g, "")}")`;
    el.classList.add("has-photo");
  } else {
    el.classList.remove("has-photo");
    el.textContent = (name || "?").trim().charAt(0).toUpperCase() || "?";
  }
}

$("logoutBtn").addEventListener("click", async () => {
  if (call) endCall(true);
  clearInterval(heartbeat);
  try { await updateDoc(myRef(), { online: false, inCall: false }); } catch (_) {}
  await signOut(auth);
  location.replace("index.html");
});
