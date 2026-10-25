// Shared Firebase setup used by every page.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

export const configured = !String(firebaseConfig.apiKey).startsWith("PASTE_");

let app = null, auth = null, db = null;
if (configured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}
export { app, auth, db };

// Small helpers shared by both pages
export function toast(message, kind = "info") {
  let box = document.getElementById("toasts");
  if (!box) {
    box = document.createElement("div");
    box.id = "toasts";
    document.body.appendChild(box);
  }
  const t = document.createElement("div");
  t.className = `toast toast-${kind}`;
  t.textContent = message;
  box.appendChild(t);
  setTimeout(() => t.classList.add("hide"), 3800);
  setTimeout(() => t.remove(), 4300);
}

export function showSetupNotice() {
  const n = document.getElementById("setupNotice");
  if (n) n.hidden = false;
}
