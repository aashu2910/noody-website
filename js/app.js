// noody live — presence, profiles, random matching and 1-to-1 WebRTC video calls.
// Firestore only carries small "signalling" messages; video goes browser-to-browser
// (or through the TURN relay when a network blocks direct connections).
import { ready, auth, db, toast, showUnavailable } from "./firebase.js";
import { iceServers as baseIceServers, turnCredentialsUrl } from "./firebase-config.js";
import { onAuthStateChanged, signOut, updateProfile } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, setDoc, updateDoc, getDoc, addDoc, collection, query, where,
  onSnapshot, serverTimestamp, arrayUnion
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

const HEARTBEAT_MS = 20000;      // "I'm still here" ping
const STALE_MS = 90000;          // silent longer than this = offline
const RING_TIMEOUT_MS = 35000;   // direct calls ring this long
const MATCH_TIMEOUT_MS = 12000;  // random matches must connect this fast or we move on
const SEARCH_TICK_MS = 2500;     // how often we look for someone while searching
const SKIP_MS = 60000;           // don't re-match someone we just skipped/missed for this long

const REGIONS = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat",
  "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh",
  "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab",
  "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand",
  "West Bengal", "Andaman and Nicobar Islands", "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Jammu and Kashmir", "Ladakh",
  "Lakshadweep", "Puducherry", "Outside India"
];
const GENDER_LABEL = { male: "Male", female: "Female", other: "Other" };

let me = null;                 // { uid, name, photo, gender, region, adult }
let heartbeat = null;
const liveUsers = new Map();   // uid -> user doc
let call = null;               // active or pending call (one at a time)
let pendingIncoming = null;    // direct call waiting for Accept/Decline
let ringer = null;
let localStream = null;
let searching = false;
let searchTimer = null;
let blocked = new Set();
const skipUntil = new Map();
let prefs = loadPrefs();

// ================================================================ start
if (!ready) {
  showUnavailable();
} else {
  onAuthStateChanged(auth, async (user) => {
    if (!user) return location.replace("/");
    me = {
      uid: user.uid,
      name: user.displayName || (user.email || "Guest").split("@")[0],
      photo: user.photoURL || null,
      gender: null, region: null, adult: false
    };
    try {
      const snap = await getDoc(myRef());
      if (snap.exists()) {
        const d = snap.data();
        me.name = d.name || me.name;
        me.gender = d.gender || null;
        me.region = d.region || null;
        me.adult = !!d.adult;
      }
      const priv = await getDoc(doc(db, "privateData", me.uid));
      if (priv.exists()) blocked = new Set(priv.data().blocked || []);
      await goLive();
    } catch (err) {
      console.error(err);
      return showUnavailable();
    }
    renderMe();
    renderPrefs();
    renderSearch();
    watchLiveUsers();
    watchIncomingCalls();
    if (!profileComplete()) openProfile(true);
  });
}

// ================================================================ presence
function myRef() { return doc(db, "users", me.uid); }

async function goLive() {
  const data = {
    name: me.name, photo: me.photo, online: true, inCall: false, searching: false,
    want: prefs.want, scope: prefs.scope, lastSeen: serverTimestamp()
  };
  if (me.gender) data.gender = me.gender;
  if (me.region) data.region = me.region;
  await setDoc(myRef(), data, { merge: true });
  clearInterval(heartbeat);
  heartbeat = setInterval(beat, HEARTBEAT_MS);
}

function beat() {
  if (me) updateDoc(myRef(), { online: true, lastSeen: serverTimestamp() }).catch(() => {});
}

function setInCall(on) {
  if (me) updateDoc(myRef(), { inCall: on, lastSeen: serverTimestamp() }).catch(() => {});
}

function publishSearch() {
  if (!me) return;
  updateDoc(myRef(), {
    searching, want: prefs.want, scope: prefs.scope, lastSeen: serverTimestamp()
  }).catch(() => {});
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") beat();
});

window.addEventListener("pagehide", () => {
  if (!me) return;
  if (call) updateDoc(call.ref, { status: "ended" }).catch(() => {});
  updateDoc(myRef(), { online: false, inCall: false, searching: false }).catch(() => {});
});

function watchLiveUsers() {
  const q = query(collection(db, "users"), where("online", "==", true));
  onSnapshot(q, (snap) => {
    liveUsers.clear();
    snap.forEach((d) => { if (d.id !== me.uid) liveUsers.set(d.id, d.data()); });
    renderUsers();
    renderSearch();
  }, (err) => { console.error(err); showUnavailable(); });
  setInterval(() => { renderUsers(); renderSearch(); }, 15000);
}

function isFresh(u) {
  const t = u.lastSeen && u.lastSeen.toMillis ? u.lastSeen.toMillis() : 0;
  return Date.now() - t < STALE_MS;
}

function freshUsers() {
  return [...liveUsers.entries()].filter(([, u]) => isFresh(u));
}

// ================================================================ profile
function profileComplete() {
  return !!(me && me.gender && me.region && me.adult);
}

function openProfile(required) {
  $("pfName").value = me.name || "";
  setSeg("pfGender", me.gender);
  $("pfRegion").value = me.region || "";
  $("pfAdult").checked = !!me.adult;
  $("pfMsg").textContent = "";
  $("pfCancel").hidden = !!required;
  $("profileModal").hidden = false;
}

(function fillRegions() {
  const sel = $("pfRegion");
  const ph = document.createElement("option");
  ph.value = ""; ph.textContent = "Select your state / region";
  sel.appendChild(ph);
  REGIONS.forEach((r) => {
    const o = document.createElement("option");
    o.value = r; o.textContent = r;
    sel.appendChild(o);
  });
})();

$("pfGender").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-v]");
  if (b) setSeg("pfGender", b.dataset.v);
});

$("pfCancel").addEventListener("click", () => { $("profileModal").hidden = true; });
$("profileBtn").addEventListener("click", () => openProfile(false));

$("profileForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("pfName").value.trim();
  const gender = segValue("pfGender");
  const region = $("pfRegion").value;
  const adult = $("pfAdult").checked;
  if (!name) return ($("pfMsg").textContent = "Please enter a name.");
  if (!gender) return ($("pfMsg").textContent = "Please choose Male, Female or Other.");
  if (!region) return ($("pfMsg").textContent = "Please choose your region.");
  if (!adult) return ($("pfMsg").textContent = "You must be 18 or older to use noody live.");
  try {
    await updateDoc(myRef(), { name, gender, region, adult: true });
    if (auth.currentUser && auth.currentUser.displayName !== name) {
      updateProfile(auth.currentUser, { displayName: name }).catch(() => {});
    }
    Object.assign(me, { name, gender, region, adult: true });
    $("profileModal").hidden = true;
    renderMe();
    toast("Profile saved.");
  } catch (err) {
    console.error(err);
    $("pfMsg").textContent = "Couldn't save right now. Please try again.";
  }
});

function renderMe() {
  $("myName").textContent = me.name;
  $("myMeta").textContent = describe(me.gender, me.region);
  paintAvatar($("myAvatar"), me.name, me.photo);
}

function describe(gender, region) {
  return [GENDER_LABEL[gender], region].filter(Boolean).join(" · ");
}

// ================================================================ match preferences
function loadPrefs() {
  const def = { want: "anyone", scope: "nearby" };
  try { return Object.assign(def, JSON.parse(localStorage.getItem("noodyPrefs") || "{}")); }
  catch (_) { return def; }
}
function savePrefs() {
  try { localStorage.setItem("noodyPrefs", JSON.stringify(prefs)); } catch (_) {}
}
function renderPrefs() {
  setSeg("wantSeg", prefs.want);
  setSeg("scopeSeg", prefs.scope);
}
$("wantSeg").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-v]");
  if (!b) return;
  prefs.want = b.dataset.v; savePrefs(); renderPrefs(); publishSearch(); renderSearch();
});
$("scopeSeg").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-v]");
  if (!b) return;
  prefs.scope = b.dataset.v; savePrefs(); renderPrefs(); publishSearch(); renderSearch();
});

function setSeg(id, value) {
  $(id).querySelectorAll("button[data-v]").forEach((b) => {
    const on = b.dataset.v === value;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", String(on));
  });
}
function segValue(id) {
  const b = $(id).querySelector("button.active");
  return b ? b.dataset.v : null;
}

// Both people must be OK with each other.
function wants(want, gender) { return !want || want === "anyone" || want === gender; }
function mutualMatch(other) {
  // other: { gender, region, want, scope }
  if (!wants(prefs.want, other.gender) || !wants(other.want, me.gender)) return false;
  if (prefs.scope === "region" && other.region !== me.region) return false;
  if (other.scope === "region" && other.region !== me.region) return false;
  return true;
}

// ================================================================ searching (random match)
$("searchBtn").addEventListener("click", () => (searching ? stopSearching() : startSearching()));

async function startSearching() {
  if (!profileComplete()) return openProfile(true);
  const stream = await ensureMedia();
  if (!stream) return;
  searching = true;
  publishSearch();
  renderSearch();
  clearInterval(searchTimer);
  searchTimer = setInterval(searchTick, SEARCH_TICK_MS);
  setTimeout(searchTick, 500 + Math.random() * 1500); // small random delay avoids collisions
}

function stopSearching(release = true) {
  searching = false;
  clearInterval(searchTimer);
  searchTimer = null;
  publishSearch();
  renderSearch();
  if (release && !call) releaseMedia();
}

function candidates() {
  const now = Date.now();
  return freshUsers().filter(([uid, u]) =>
    u.searching && !u.inCall && u.gender && u.region &&
    !blocked.has(uid) && !((skipUntil.get(uid) || 0) > now) &&
    mutualMatch(u));
}

function searchTick() {
  if (!searching || call || pendingIncoming) return;
  const list = candidates();
  if (!list.length) return renderSearch();
  let pool = list;
  if (prefs.scope !== "anywhere") {
    const near = list.filter(([, u]) => u.region === me.region);
    if (near.length) pool = near;
  }
  const [uid, u] = pool[Math.floor(Math.random() * pool.length)];
  startCall(uid, u, "match");
}

function renderSearch() {
  if (!me) return;
  const btn = $("searchBtn");
  btn.textContent = searching ? "Stop searching" : "Start";
  btn.classList.toggle("btn-primary", !searching);
  btn.classList.toggle("btn-ghost", searching);
  $("searchingBadge").hidden = !searching;
  const status = $("searchStatus");
  if (!searching) {
    const n = freshUsers().filter(([, u]) => u.searching && !u.inCall).length;
    status.textContent = n ? `${n} ${n === 1 ? "person is" : "people are"} looking right now.` : "";
    return;
  }
  if (call && call.mode === "match" && !call.connected) {
    status.textContent = `Found ${call.peer.name || "someone"} — connecting…`;
    return;
  }
  const n = candidates().length;
  status.textContent = n
    ? "Someone's available — connecting you…"
    : "Looking for someone… we'll keep searching until someone's free.";
}

// ================================================================ media
async function ensureMedia() {
  if (localStream && localStream.getTracks().some((t) => t.readyState === "live")) return localStream;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch (e1) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      toast("No camera available — joining with audio only.");
    } catch (e2) {
      console.error(e2);
      toast("Allow camera and microphone access in your browser to make calls.", "error");
      localStream = null;
      return null;
    }
  }
  $("previewVideo").srcObject = localStream;
  $("previewOff").hidden = localStream.getVideoTracks().length > 0;
  return localStream;
}

function releaseMedia() {
  if (localStream) localStream.getTracks().forEach((t) => t.stop());
  localStream = null;
  $("previewVideo").srcObject = null;
  $("previewOff").hidden = false;
}

// TURN credentials (cached ~30 minutes)
let iceCache = null, iceCacheAt = 0;
async function getIceServers() {
  if (iceCache && Date.now() - iceCacheAt < 30 * 60 * 1000) return iceCache;
  let list = [...baseIceServers];
  if (turnCredentialsUrl) {
    try {
      const r = await fetch(turnCredentialsUrl);
      if (r.ok) {
        const extra = await r.json();
        if (Array.isArray(extra)) list = list.concat(extra);
      }
    } catch (err) { console.error(err); }
  }
  iceCache = list; iceCacheAt = Date.now();
  return list;
}

async function createPeer(stream) {
  const pc = new RTCPeerConnection({ iceServers: await getIceServers() });
  stream.getTracks().forEach((t) => pc.addTrack(t, stream));

  const remoteStream = new MediaStream();
  $("remoteVideo").srcObject = remoteStream;
  pc.ontrack = (e) => {
    (e.streams[0] ? e.streams[0].getTracks() : [e.track]).forEach((t) => remoteStream.addTrack(t));
    if (e.track.kind === "video") $("remotePlaceholder").hidden = true;
  };

  pc.onconnectionstatechange = () => {
    if (!call || call.pc !== pc) return;
    const s = pc.connectionState;
    if (s === "connected") {
      call.connected = true;
      clearTimeout(call.timeout);
      startTimer();
    } else if (s === "disconnected") {
      setStatus("Reconnecting…");
    } else if (s === "failed") {
      if (call.mode === "match") {
        skipUntil.set(call.peerId, Date.now() + SKIP_MS);
        endCall(true, null);
      } else {
        endCall(true, "Couldn't connect the call. Please try again.");
      }
    }
  };
  return pc;
}

// ICE candidates can arrive before the remote description — queue until ready.
function candidateAdder(pc) {
  const queue = [];
  const add = (c) => pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
  return {
    push(c) { pc.remoteDescription ? add(c) : queue.push(c); },
    flush() { while (queue.length) add(queue.shift()); }
  };
}

// ================================================================ outgoing call
async function startCall(peerId, peer, mode) {
  if (call) return;
  if (mode === "direct" && searching) stopSearching(false);
  const stream = await ensureMedia();
  if (!stream || call) return;

  const ref = doc(collection(db, "calls"));
  const placeholder = { id: ref.id, ref, pc: null, role: "caller", mode, peerId, peer, unsubs: [], timeout: null, connected: false };
  call = placeholder; // reserve the slot while we set up
  const pc = await createPeer(stream);
  if (call !== placeholder) { pc.close(); return; }
  call.pc = pc;
  const cands = candidateAdder(pc);

  if (mode === "direct") openCallScreen("Calling…");
  setInCall(true);
  renderUsers();
  renderSearch();

  pc.onicecandidate = (e) => {
    if (e.candidate) addDoc(collection(ref, "offerCandidates"), e.candidate.toJSON()).catch(() => {});
  };

  try {
    const offer = await pc.createOffer();
    await setDoc(ref, {
      from: me.uid, fromName: me.name, fromPhoto: me.photo,
      fromGender: me.gender, fromRegion: me.region, fromWant: prefs.want, fromScope: prefs.scope,
      to: peerId, toName: peer.name || "Someone",
      mode, status: "ringing",
      offer: { type: offer.type, sdp: offer.sdp },
      createdAt: serverTimestamp()
    });
    await pc.setLocalDescription(offer);
  } catch (err) {
    console.error(err);
    return endCall(false, mode === "direct" ? "Couldn't start the call. Please try again." : null);
  }

  call.unsubs.push(onSnapshot(ref, (snap) => {
    const d = snap.data();
    if (!d || !call || call.id !== ref.id) return;
    if (d.answer && !pc.currentRemoteDescription) {
      pc.setRemoteDescription(new RTCSessionDescription(d.answer)).then(() => cands.flush()).catch(() => {});
      if (mode === "match") openCallScreen("Connecting…");
      else setStatus("Connecting…");
    }
    if (["declined", "busy", "ended", "missed"].includes(d.status)) {
      if (mode === "match") {
        skipUntil.set(peerId, Date.now() + SKIP_MS);
        endCall(false, call && call.connected ? "They left — finding someone new…" : null);
      } else {
        const msg = {
          declined: `${peer.name || "They"} declined the call`,
          busy: `${peer.name || "They"} is busy right now`,
          ended: "Call ended",
          missed: "No answer"
        }[d.status];
        endCall(false, msg);
      }
    }
  }));

  call.unsubs.push(onSnapshot(collection(ref, "answerCandidates"), (snap) => {
    snap.docChanges().forEach((ch) => { if (ch.type === "added") cands.push(ch.doc.data()); });
  }));

  call.timeout = setTimeout(() => {
    if (call && call.id === ref.id && !call.connected) {
      updateDoc(ref, { status: "missed" }).catch(() => {});
      if (mode === "match") {
        skipUntil.set(peerId, Date.now() + SKIP_MS);
        endCall(false, null);
      } else {
        endCall(false, `${peer.name || "They"} didn't answer`);
      }
    }
  }, mode === "match" ? MATCH_TIMEOUT_MS : RING_TIMEOUT_MS);
}

// ================================================================ incoming calls
function watchIncomingCalls() {
  const q = query(collection(db, "calls"), where("to", "==", me.uid), where("status", "==", "ringing"));
  onSnapshot(q, (snap) => {
    snap.docChanges().forEach((ch) => {
      const data = ch.doc.data();
      const id = ch.doc.id;
      if (ch.type === "added") handleIncoming(id, data, ch.doc.ref);
      if (ch.type === "removed" && pendingIncoming && pendingIncoming.id === id) {
        if (!call) toast(`Missed call from ${pendingIncoming.data.fromName || "someone"}`);
        hideIncoming();
      }
    });
  }, (err) => { console.error(err); showUnavailable(); });
}

function handleIncoming(id, data, ref) {
  const created = data.createdAt && data.createdAt.toMillis ? data.createdAt.toMillis() : Date.now();
  if (Date.now() - created > RING_TIMEOUT_MS + 10000) return;            // old leftover
  if (blocked.has(data.from)) return void updateDoc(ref, { status: "declined" }).catch(() => {});

  // Two people picked each other at the same moment: the lower user id keeps its call.
  if (call && call.role === "caller" && !call.connected && call.peerId === data.from) {
    if (me.uid > data.from) {
      endCall(true, null);
      acceptCall(id, data);
    } else {
      updateDoc(ref, { status: "busy" }).catch(() => {});
    }
    return;
  }

  if (call || pendingIncoming) return void updateDoc(ref, { status: "busy" }).catch(() => {});

  if (data.mode === "match") {
    const other = { gender: data.fromGender, region: data.fromRegion, want: data.fromWant, scope: data.fromScope };
    if (searching && profileComplete() && mutualMatch(other)) acceptCall(id, data);
    else updateDoc(ref, { status: "declined" }).catch(() => {});
    return;
  }
  showIncoming(id, data);
}

function showIncoming(id, data) {
  pendingIncoming = { id, data };
  $("incomingName").textContent = data.fromName || "Someone";
  $("incomingMeta").textContent = describe(data.fromGender, data.fromRegion);
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

$("acceptBtn").addEventListener("click", () => {
  if (!pendingIncoming || call) return;
  const { id, data } = pendingIncoming;
  hideIncoming();
  if (searching) stopSearching(false);
  acceptCall(id, data);
});

async function acceptCall(id, data) {
  if (call) return;
  const ref = doc(db, "calls", id);
  const placeholder = {
    id, ref, pc: null, role: "callee", mode: data.mode || "direct", peerId: data.from,
    peer: { name: data.fromName, photo: data.fromPhoto, gender: data.fromGender, region: data.fromRegion },
    unsubs: [], timeout: null, connected: false
  };
  call = placeholder;

  try {
    const fresh = await getDoc(ref);
    if (!fresh.exists() || fresh.data().status !== "ringing") {
      call = null;
      if (placeholder.mode === "direct") toast("That call has already ended.");
      return;
    }
  } catch (err) { console.error(err); call = null; return; }

  const stream = await ensureMedia();
  if (!stream || call !== placeholder) {
    if (call === placeholder) call = null;
    updateDoc(ref, { status: "declined" }).catch(() => {});
    return;
  }

  const pc = await createPeer(stream);
  if (call !== placeholder) { pc.close(); return; }
  call.pc = pc;
  const cands = candidateAdder(pc);

  openCallScreen("Connecting…");
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
    return endCall(true, placeholder.mode === "direct" ? "Couldn't connect the call. Please try again." : null);
  }

  call.unsubs.push(onSnapshot(collection(ref, "offerCandidates"), (snap) => {
    snap.docChanges().forEach((ch) => { if (ch.type === "added") cands.push(ch.doc.data()); });
  }));
  call.unsubs.push(onSnapshot(ref, (snap) => {
    const d = snap.data();
    if (d && d.status === "ended" && call && call.id === id) {
      if (placeholder.mode === "match") skipUntil.set(data.from, Date.now() + SKIP_MS);
      endCall(false, placeholder.mode === "match" ? (searching ? "They left — finding someone new…" : "Call ended") : "Call ended");
    }
  }));

  // If it never connects, give up (and keep searching in match mode).
  call.timeout = setTimeout(() => {
    if (call && call.id === id && !call.connected) {
      if (placeholder.mode === "match") skipUntil.set(data.from, Date.now() + SKIP_MS);
      endCall(true, placeholder.mode === "match" ? null : "Couldn't connect the call. Please try again.");
    }
  }, 20000);
}

// ================================================================ end / next / report
function endCall(notifyOther, message) {
  if (!call) return;
  const c = call;
  call = null;
  clearTimeout(c.timeout);
  c.unsubs.forEach((u) => u());
  if (notifyOther) updateDoc(c.ref, { status: "ended" }).catch(() => {});
  try { if (c.pc) c.pc.close(); } catch (_) {}
  closeCallScreen();
  setInCall(false);
  if (!searching) releaseMedia();
  renderUsers();
  renderSearch();
  if (message) toast(message);
}

$("hangupBtn").addEventListener("click", () => {
  if (searching) stopSearching(false);
  endCall(true, "Call ended");
});

$("nextBtn").addEventListener("click", () => {
  if (!call) return;
  skipUntil.set(call.peerId, Date.now() + SKIP_MS);
  if (!searching) {
    searching = true;
    publishSearch();
    clearInterval(searchTimer);
    searchTimer = setInterval(searchTick, SEARCH_TICK_MS);
  }
  endCall(true, null);
  setTimeout(searchTick, 800 + Math.random() * 1200);
});

$("reportBtn").addEventListener("click", async () => {
  if (!call) return;
  const peerId = call.peerId;
  const callId = call.id;
  blockUser(peerId);
  endCall(true, "Reported. You won't be matched with this person again.");
  try {
    await addDoc(collection(db, "reports"), {
      reporter: me.uid, reported: peerId, callId, createdAt: serverTimestamp()
    });
  } catch (err) { console.error(err); }
});

function blockUser(uid) {
  blocked.add(uid);
  setDoc(doc(db, "privateData", me.uid), { blocked: arrayUnion(uid) }, { merge: true }).catch(() => {});
}

// ================================================================ who's live list
function renderUsers() {
  if (!me) return;
  const list = $("userList");
  list.textContent = "";
  const people = freshUsers()
    .filter(([uid]) => !blocked.has(uid))
    .sort((a, b) => {
      const an = a[1].region === me.region ? 0 : 1, bn = b[1].region === me.region ? 0 : 1;
      return an - bn || (a[1].name || "").localeCompare(b[1].name || "");
    });

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
    const meta = document.createElement("span");
    meta.className = "user-meta";
    meta.textContent = describe(u.gender, u.region);
    const st = document.createElement("span");
    st.className = "user-state" + (u.inCall ? " busy" : u.searching ? " looking" : "");
    st.textContent = u.inCall ? "In a call" : u.searching ? "Looking for a match" : "Live now";
    info.append(nm, meta, st);

    const btn = document.createElement("button");
    btn.className = "btn btn-primary btn-sm";
    btn.type = "button";
    btn.textContent = "Call";
    btn.disabled = !!u.inCall || !!call;
    btn.addEventListener("click", () => startCall(uid, u, "direct"));

    li.append(av, info, btn);
    list.appendChild(li);
  }
}

// ================================================================ call screen
let timerId = null;

function openCallScreen(status) {
  if (!call) return;
  const p = call.peer || {};
  $("callPeer").textContent = p.name || "Someone";
  $("callMeta").textContent = describe(p.gender, p.region);
  paintAvatar($("peerAvatar"), p.name, p.photo);
  $("remotePlaceholder").hidden = false;
  $("localVideo").srcObject = localStream;
  $("nextBtn").hidden = call.mode !== "match";
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
  if (localStream) localStream.getTracks().forEach((t) => (t.enabled = true));
  [["micBtn", "Mute microphone"], ["camBtn", "Turn camera off"]].forEach(([id, title]) => {
    $(id).classList.remove("off");
    $(id).setAttribute("aria-pressed", "false");
    $(id).title = title;
  });
}

function toggleTrack(kind, btnId, onTitle, offTitle) {
  if (!localStream) return;
  const tracks = kind === "audio" ? localStream.getAudioTracks() : localStream.getVideoTracks();
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

// ================================================================ ringtone
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
  } catch (_) { /* audio blocked — popup still shows */ }
}

function stopRinging() {
  document.title = "noody live";
  if (!ringer) return;
  clearInterval(ringer.id);
  ringer.ctx.close().catch(() => {});
  ringer = null;
}

// ================================================================ misc
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
  searching = false;
  clearInterval(searchTimer);
  clearInterval(heartbeat);
  releaseMedia();
  try { await updateDoc(myRef(), { online: false, inCall: false, searching: false }); } catch (_) {}
  await signOut(auth);
  location.replace("/");
});
