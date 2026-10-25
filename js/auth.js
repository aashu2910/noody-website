// Login / sign-up page logic
import { ready, auth, showUnavailable } from "./firebase.js";
import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  updateProfile,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const $ = (id) => document.getElementById(id);
const form = $("authForm");
const msg = $("authMsg");
let mode = "login";

function setMsg(text, kind = "error") {
  msg.textContent = text;
  msg.className = `form-msg ${kind}`;
}

function setMode(next) {
  mode = next;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.mode === mode));
  document.querySelectorAll(".signup-only").forEach((el) => (el.hidden = mode !== "signup"));
  document.querySelectorAll(".login-only").forEach((el) => (el.hidden = mode !== "login"));
  $("submitBtn").textContent = mode === "login" ? "Log in" : "Create account";
  $("password").autocomplete = mode === "login" ? "current-password" : "new-password";
  setMsg("", "");
}

document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => setMode(t.dataset.mode)));

function friendly(err) {
  const map = {
    "auth/invalid-email": "That email address doesn't look right.",
    "auth/missing-password": "Please enter your password.",
    "auth/weak-password": "Password needs at least 6 characters.",
    "auth/email-already-in-use": "An account with this email already exists — try logging in.",
    "auth/invalid-credential": "Wrong email or password.",
    "auth/wrong-password": "Wrong email or password.",
    "auth/user-not-found": "No account with that email — create one first.",
    "auth/too-many-requests": "Too many attempts. Wait a minute and try again.",
    "auth/popup-closed-by-user": "Google sign-in was closed before finishing.",
    "auth/unauthorized-domain": "This sign-in option isn't available right now.",
    "auth/operation-not-allowed": "This sign-in option isn't available right now.",
    "auth/network-request-failed": "Network problem — check your connection."
  };
  console.error(err);
  return map[err.code] || "Something went wrong. Please try again.";
}

function busy(on) {
  form.querySelectorAll("button, input").forEach((el) => (el.disabled = on));
  $("googleBtn").disabled = on;
}

if (!ready) {
  showUnavailable();
  busy(true);
} else {
  // Already logged in? Go straight to the app.
  onAuthStateChanged(auth, (user) => {
    if (user) location.replace("app.html");
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("email").value.trim();
    const password = $("password").value;
    const name = $("name").value.trim();
    if (mode === "signup" && !name) return setMsg("Please enter your name.");
    busy(true);
    setMsg("Please wait…", "info");
    try {
      if (mode === "signup") {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(cred.user, { displayName: name });
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      location.replace("app.html");
    } catch (err) {
      setMsg(friendly(err));
      busy(false);
    }
  });

  $("googleBtn").addEventListener("click", async () => {
    busy(true);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
      location.replace("app.html");
    } catch (err) {
      setMsg(friendly(err));
      busy(false);
    }
  });

  $("forgotBtn").addEventListener("click", async () => {
    const email = $("email").value.trim();
    if (!email) return setMsg("Type your email above first, then click “Forgot password?”.");
    try {
      await sendPasswordResetEmail(auth, email);
      setMsg("Password reset email sent — check your inbox (and spam).", "success");
    } catch (err) {
      setMsg(friendly(err));
    }
  });
}

setMode("login");
