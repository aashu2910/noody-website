// ============================================================
//  STEP 1 — Paste YOUR Firebase web config here.
//  Firebase Console → Project settings (gear icon) → General
//  → "Your apps" → Web app → SDK setup and configuration → Config
//  These values are public by design. Your Firestore security
//  rules (firestore.rules) are what keep the data safe.
// ============================================================
export const firebaseConfig = {
  apiKey: "PASTE_YOUR_API_KEY",
  authDomain: "PASTE_YOUR_PROJECT.firebaseapp.com",
  projectId: "PASTE_YOUR_PROJECT_ID",
  storageBucket: "PASTE_YOUR_PROJECT.appspot.com",
  messagingSenderId: "PASTE_YOUR_SENDER_ID",
  appId: "PASTE_YOUR_APP_ID"
};

// ============================================================
//  Servers WebRTC uses to find a path between two browsers.
//  The free Google STUN servers work for most home/mobile networks.
//  If calls connect on Wi-Fi but fail on some office/college or
//  mobile networks, add a TURN server (e.g. a free Metered.ca
//  account) like the commented example below.
// ============================================================
export const iceServers = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }
  // ,{ urls: "turn:YOUR_TURN_HOST:443", username: "USERNAME", credential: "PASSWORD" }
];
