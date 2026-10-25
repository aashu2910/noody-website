// ============================================================
//  STEP 1 — Paste YOUR Firebase web config here.
//  Firebase Console → Project settings (gear icon) → General
//  → "Your apps" → Web app → SDK setup and configuration → Config
//  These values are public by design. Your Firestore security
//  rules (firestore.rules) are what keep the data safe.
// ============================================================
export const firebaseConfig = {
  apiKey: "AIzaSyBCZs6jwQ5wyW9rCiBiXARqX7U0Q-zkVm0",
  authDomain: "noody-live.firebaseapp.com",
  projectId: "noody-live",
  storageBucket: "noody-live.firebasestorage.app",
  messagingSenderId: "647666331434",
  appId: "1:647666331434:web:5aa05671049e91e921f853",
  measurementId: "G-1CNW1HSD01"
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
