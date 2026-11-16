// NPay lock — the PIN pad and Face ID / fingerprint, shared by the wallet and the terminal.
//
//   Lock.unlock(user, { onForgot })      app lock; resolves when the PIN or biometrics pass
//   Lock.confirm(user, title, detail)    before a payment; resolves true / false (cancelled)
//   Lock.setup(user, { required, reset }) choose a new PIN (twice)
//   Lock.change(user)                    old PIN, then a new one
//   Lock.bio                             Face ID / fingerprint on this device
//
// The PIN is checked by the database (Backend.verifyPin). Face ID uses the device's own
// screen lock through WebAuthn (passkeys); it never leaves the phone.
const Lock = (() => {
  const PIN_LEN = 4;
  const BIO_KEY = (uid) => "npay.bio." + uid;
  const FACE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M9 9v1.5M15 9v1.5M12 9v4h-1M9.5 16a4 4 0 0 0 5 0"/></svg>';
  const FINGER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 11v3a8 8 0 0 1-1.2 4.2M8.5 7.6A5 5 0 0 1 17 11v1.5M7 11a5 5 0 0 1 .4-2M7 14.5c0 1.6-.4 3.1-1 4.5M17 15.5c-.1 1.6-.4 3-1 4.3M10 21c.6-1 1-2.1 1.3-3.3M14 11a2 2 0 0 0-4 0v1"/></svg>';
  const DEL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1zM17 9l-6 6M11 9l6 6"/></svg>';
  const isApple = /iPhone|iPad|Macintosh/.test(navigator.userAgent);
  const BIO_NAME = isApple ? "Face ID" : "fingerprint or face unlock";

  // ---------- markup ----------
  const root = document.createElement("div");
  root.className = "lock";
  root.id = "lock";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-hidden", "true");
  root.setAttribute("aria-labelledby", "lkTitle");
  root.innerHTML = `
    <div class="lock-inner">
      <span class="avatar xl" id="lkAvatar"></span>
      <h2 class="lock-title" id="lkTitle">Enter your PIN</h2>
      <p class="lock-sub" id="lkSub"></p>
      <div class="pin-dots" id="lkDots" aria-hidden="true">${"<i></i>".repeat(PIN_LEN)}</div>
      <p class="lock-err" id="lkErr" role="alert"></p>
      <div class="keypad" id="lkPad">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" data-k="${n}">${n}</button>`).join("")}
        <button type="button" class="k-icon" id="lkBio" aria-label="Use ${BIO_NAME}">${isApple ? FACE : FINGER}</button>
        <button type="button" data-k="0">0</button>
        <button type="button" class="k-icon" id="lkDel" aria-label="Delete">${DEL}</button>
      </div>
      <div class="lock-foot">
        <button type="button" class="lock-link" id="lkCancel">Cancel</button>
        <button type="button" class="lock-link" id="lkForgot">Forgot PIN?</button>
      </div>
    </div>`;
  document.body.appendChild(root);
  const $ = (id) => document.getElementById(id);

  let entry = "";
  let handler = null;   // async (pin) => true to finish, or a message string to show
  let finish = null;    // resolve of the current promise
  let busy = false;

  function dots() {
    $("lkDots").querySelectorAll("i").forEach((d, i) => d.classList.toggle("on", i < entry.length));
  }
  function error(msg) {
    $("lkErr").textContent = msg || "";
    if (msg) {
      $("lkDots").classList.remove("shake");
      void $("lkDots").offsetWidth;
      $("lkDots").classList.add("shake");
      if (navigator.vibrate) navigator.vibrate(60);
    }
  }

  async function press(k) {
    if (busy || !handler) return;
    if (k === "del") { entry = entry.slice(0, -1); dots(); return; }
    if (entry.length >= PIN_LEN) return;
    entry += k;
    dots();
    error("");
    if (entry.length < PIN_LEN) return;
    busy = true;
    $("lkDots").classList.add("checking");
    const pin = entry;
    let res;
    try { res = await handler(pin); } catch (e) { res = e.message || "Something went wrong"; }
    $("lkDots").classList.remove("checking");
    busy = false;
    entry = "";
    dots();
    if (res !== true && res) error(res);
  }

  $("lkPad").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.id === "lkDel") press("del");
    else if (b.dataset.k) press(b.dataset.k);
  });
  document.addEventListener("keydown", (e) => {
    if (!root.classList.contains("open")) return;
    if (/^[0-9]$/.test(e.key)) { e.preventDefault(); press(e.key); }
    else if (e.key === "Backspace") { e.preventDefault(); press("del"); }
    else if (e.key === "Escape" && !$("lkCancel").hidden) $("lkCancel").click();
  });

  function show({ user, title, sub = "", cancel = false, forgot = null, bio = false }) {
    NPay.paintAvatar($("lkAvatar"), user || {});
    $("lkTitle").textContent = title;
    $("lkSub").textContent = sub;
    $("lkSub").hidden = !sub;
    $("lkCancel").hidden = !cancel;
    $("lkForgot").hidden = !forgot;
    $("lkForgot").onclick = forgot;
    $("lkBio").style.visibility = bio ? "visible" : "hidden";
    entry = "";
    dots();
    error("");
    root.classList.add("open");
    root.setAttribute("aria-hidden", "false");
    document.activeElement?.blur?.();
  }
  function hide() {
    root.classList.remove("open");
    root.setAttribute("aria-hidden", "true");
    handler = null;
  }
  const isOpen = () => root.classList.contains("open");

  function pinMessage(r) {
    if (r.ok) return true;
    if (r.error === "locked") {
      const mins = r.locked_until ? Math.max(1, Math.ceil((new Date(r.locked_until) - Date.now()) / 60000)) : 5;
      return `Too many tries. Try again in ${mins} min${mins === 1 ? "" : "s"}`;
    }
    if (r.error === "wrong") return r.attempts_left === 1 ? "Wrong PIN — 1 try left" : `Wrong PIN — ${r.attempts_left} tries left`;
    if (r.error === "none") return "No PIN set yet";
    return "Couldn't check your PIN";
  }

  // ---------- biometrics (WebAuthn platform authenticator) ----------
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
  const challenge = () => crypto.getRandomValues(new Uint8Array(32));

  const bio = {
    name: BIO_NAME,
    async available() {
      try { return !!window.PublicKeyCredential && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); }
      catch { return false; }
    },
    enabled: (uid) => !!NPay.store.get(BIO_KEY(uid), null),
    async enable(user) {
      const cred = await navigator.credentials.create({
        publicKey: {
          challenge: challenge(),
          rp: { name: "NPay" },
          user: { id: new TextEncoder().encode(user.id), name: "@" + user.username, displayName: user.name },
          pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
          authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged" },
          timeout: 60000,
          attestation: "none",
        },
      });
      NPay.store.set(BIO_KEY(user.id), b64(cred.rawId));
    },
    disable: (uid) => NPay.store.remove(BIO_KEY(uid)),
    async verify(uid) {
      const id = NPay.store.get(BIO_KEY(uid), null);
      if (!id) return false;
      try {
        await navigator.credentials.get({
          publicKey: { challenge: challenge(), allowCredentials: [{ type: "public-key", id: unb64(id), transports: ["internal"] }], userVerification: "required", timeout: 60000 },
        });
        return true;
      } catch {
        return false;
      }
    },
  };

  function wireBio(user, done) {
    $("lkBio").onclick = async () => {
      if (busy) return;
      busy = true;
      const ok = await bio.verify(user.id);
      busy = false;
      if (ok) done();
      else error(`${isApple ? "Face ID" : "Biometrics"} didn't work — enter your PIN`);
    };
  }

  // ---------- flows ----------
  function unlock(user, { onForgot } = {}) {
    return new Promise((resolve) => {
      const useBio = bio.enabled(user.id);
      const done = () => { hide(); resolve(true); };
      show({ user, title: `Hi ${user.name.split(" ")[0]}`, sub: "Enter your PIN to open NPay", forgot: onForgot ? () => { hide(); onForgot(); } : null, bio: useBio });
      handler = async (pin) => { const r = pinMessage(await Backend.verifyPin(pin)); if (r === true) done(); return r; };
      wireBio(user, done);
      if (useBio) setTimeout(() => $("lkBio").click(), 350);
    });
  }

  function confirm(user, title, detail) {
    return new Promise((resolve) => {
      const useBio = bio.enabled(user.id);
      const done = (ok) => { hide(); resolve(ok); };
      show({ user, title, sub: detail || "Enter your PIN to confirm", cancel: true, bio: useBio });
      $("lkCancel").onclick = () => done(false);
      handler = async (pin) => { const r = pinMessage(await Backend.verifyPin(pin)); if (r === true) done(true); return r; };
      wireBio(user, () => done(true));
      if (useBio) setTimeout(() => $("lkBio").click(), 350);
    });
  }

  // Ask for a new PIN twice. `oldPin` is sent along when changing it.
  function chooseNew(user, { required, oldPin = null, title = "Choose a PIN" }) {
    return new Promise((resolve) => {
      let first = null;
      show({ user, title, sub: "4 digits. You'll use it to open NPay and to confirm payments.", cancel: !required });
      $("lkCancel").onclick = () => { hide(); resolve(false); };
      handler = async (pin) => {
        if (!first) {
          if (/^(\d)\1{3}$/.test(pin) || "0123456789".includes(pin) || "9876543210".includes(pin)) return "Too easy to guess — pick another";
          first = pin;
          $("lkTitle").textContent = "Enter it again";
          return true;
        }
        if (pin !== first) {
          first = null;
          $("lkTitle").textContent = title;
          return "The PINs didn't match — start again";
        }
        const r = await Backend.setPin(pin, oldPin);
        if (!r.ok) {
          first = null;
          $("lkTitle").textContent = title;
          return r.error === "needs_password" ? "Sign in with your password again to reset your PIN" : pinMessage(r);
        }
        hide();
        resolve(true);
        return true;
      };
    });
  }

  const setup = (user, { required = true, reset = false } = {}) =>
    chooseNew(user, { required, title: reset ? "Choose a new PIN" : "Choose a PIN" });

  function change(user) {
    return new Promise((resolve) => {
      show({ user, title: "Enter your current PIN", cancel: true });
      $("lkCancel").onclick = () => { hide(); resolve(false); };
      handler = async (pin) => {
        const r = await Backend.verifyPin(pin);
        const msg = pinMessage(r);
        if (msg !== true) return msg;
        resolve(await chooseNew(user, { required: false, oldPin: pin, title: "Choose a new PIN" }));
        return true;
      };
    });
  }

  return { unlock, confirm, setup, change, bio, isOpen, hide };
})();
