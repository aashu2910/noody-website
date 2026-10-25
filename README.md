# noody live

Sign in, see who's live, and start a 1-to-1 video call. It's a static site, so it's hosted free on **GitHub Pages**, with **Firebase** (free plan) handling logins and the live list.

```
noody live/
├── index.html          ← login / create account page
├── app.html            ← "who's live" list + video call screen
├── css/style.css       ← all the styling
├── js/firebase-config.js  ← ★ the only file you must edit (paste your Firebase keys)
├── js/firebase.js      ← connects to Firebase (no edits needed)
├── js/auth.js          ← login / sign-up logic
├── js/app.js           ← live list + calling logic
├── firestore.rules     ← security rules you paste into Firebase
└── CNAME               ← tells GitHub Pages to use noody.online
```

**How it works:** Firebase Auth handles accounts. Each signed-in user writes "I'm online" to Firestore every 20 seconds, which builds the live list. When you click **Call**, the two browsers swap connection details through Firestore. The video and audio then go **directly between the two browsers** using WebRTC, so they never pass through any server.

---

## Part A: Set up Firebase (one time, ~10 min)

1. Go to **https://console.firebase.google.com** and sign in with your Google account.
2. Click **Create a project**, name it `noody-live`, turn **Google Analytics off**, then click **Create project**.
3. **Register the website.** On the project home page, click the **`</>` (Web)** icon. Use the nickname `noody live`, leave "Firebase Hosting" **unchecked**, and click **Register app**.
   Firebase shows a block that looks like `const firebaseConfig = { apiKey: "...", ... }`. Copy the six values into **`js/firebase-config.js`**, replacing each `PASTE_...` text, and save the file.
4. **Turn on login methods.** In the left menu, go to **Build → Authentication → Get started → Sign-in method**:
   - Click **Email/Password**, switch on **Enable** (the first toggle only), and click **Save**.
   - Click **Add new provider → Google**, switch on **Enable**, choose your support email, and click **Save**.
5. **Allow your domain.** Still in Authentication, open the **Settings** tab → **Authorized domains → Add domain**. Add `noody.online`, then add `www.noody.online`. (`localhost` is already there for testing.)
6. **Create the database.** Go to **Build → Firestore Database → Create database**:
   - Location: **asia-south1 (Mumbai)**. This can't be changed later.
   - Choose **Start in production mode** and click **Create**.
7. **Add the security rules.** In Firestore, open the **Rules** tab. Delete what's there, paste the whole contents of **`firestore.rules`**, and click **Publish**.

Firebase is now ready.

---

## Part B: Test on your own PC first (optional, recommended)

The pages use JavaScript modules, so double-clicking `index.html` **won't work**. You need a small local server:

- **VS Code:** install the **Live Server** extension, right-click `index.html`, and choose **Open with Live Server**.
- **Or Python:** open a terminal in this folder, run `python -m http.server 5500`, and open `http://localhost:5500`.

To test a call alone, open the site in **Chrome** and also in **Edge** (or a Chrome Incognito window), then create two different accounts. Each account will see the other in "Who's live". Click **Call** and accept in the other window.

---

## Part C: Put it live on noody.online (GitHub Pages)

Your domain's DNS already points at GitHub Pages, so you only need to replace the files in the repo.

**Option 1: GitHub website (no Git needed)**
1. Open the GitHub repo that currently serves noody.online.
2. Delete the old `index.html` (open it, click the **⋯** menu, then **Delete file**, then **Commit**).
3. Click **Add file → Upload files**. Drag **everything inside** the `noody live` folder (`index.html`, `app.html`, `CNAME`, `firestore.rules`, `README.md`, and the `css` and `js` folders) into the page, then click **Commit changes**.
   Drag the *contents* of the folder, not the `noody live` folder itself. `index.html` must sit at the top level of the repo.

**Option 2: Git command line** (run from inside `D:\project\noody live`)
```bash
git init
git add .
git commit -m "noody live: login, live list, video calls"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main --force
```
`--force` replaces whatever was in the repo before. Use it only on the noody.online repo.

**After pushing:**
1. In the repo, go to **Settings → Pages** and check that Custom domain still shows `noody.online` and **Enforce HTTPS** is ticked.
2. Wait 1–2 minutes, then open **https://noody.online**.
3. Test with a friend, or with your phone on mobile data plus your PC.

> Camera and mic only work on **https://** (or localhost). That's another reason Enforce HTTPS has to be on.

---

## Updating later

Edit the files in `D:\project\noody live`, then upload or push again. GitHub Pages redeploys automatically in about a minute. If you don't see the change, press **Ctrl+F5** to clear the browser cache.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Yellow "Firebase isn't set up yet" bar | Values in `js/firebase-config.js` are still `PASTE_...`. Redo Part A step 3. |
| "This domain isn't allowed yet" on Google login | Add `noody.online` under Authentication → Settings → Authorized domains. |
| "Missing or insufficient permissions" | The rules weren't published. Redo Part A step 7. |
| Blank page locally | You opened the file directly. Use Live Server (Part B). |
| Camera/mic blocked | Click the camera icon in the browser address bar and allow access, then reload. |
| Call rings and connects, but no video and it ends with "Connection failed" | Some networks (offices, colleges, some mobile carriers) block direct connections. Add a **TURN server**: create a free account at metered.ca → TURN server, then paste the server URL, username and password into the commented line in `js/firebase-config.js`. |
| Someone still shows as live after closing the tab | They disappear automatically within ~90 seconds. |

## Free-plan limits

The Firebase Spark (free) plan gives **50,000 reads and 20,000 writes per day**. Each live user makes about 3 writes a minute (the "I'm online" heartbeat), so this comfortably covers a small group of friends using it every day. Video uses no Firebase quota because it goes browser to browser.
