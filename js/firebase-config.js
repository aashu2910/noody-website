// Firebase web config for the noody-live project.
// (These values are meant to be in website code; the key is locked to noody.online
//  in Google Cloud, and Firestore rules protect the data.)
export const firebaseConfig = {
  apiKey: "AIzaSyBCZs6jwQ5wyW9rCiBiXARqX7U0Q-zkVm0",
  authDomain: "noody-live.firebaseapp.com",
  projectId: "noody-live",
  storageBucket: "noody-live.firebasestorage.app",
  messagingSenderId: "647666331434",
  appId: "1:647666331434:web:5aa05671049e91e921f853",
  measurementId: "G-1CNW1HSD01"
};

// Free Google STUN servers — enough when both people are on simple home Wi-Fi.
export const iceServers = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }
];

// TURN relay — needed for calls on mobile data (Jio/Airtel etc.), office or college Wi-Fi.
// Paste your Metered.ca credentials link here (see _setup/README.md → "Make calls connect everywhere").
// Example: "https://noody.metered.live/api/v1/turn/credentials?apiKey=abc123..."
export const turnCredentialsUrl = "tsnR_oCXTC_8Rlxdj3bma-DEdG6HAf9Yms6cj1QabpRejcb5";
