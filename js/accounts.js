// NPay accounts — stored on this device only (localStorage). There is no server, so an
// account lives in the browser that created it. Passwords are never stored: only a salted
// PBKDF2-SHA-256 hash.
const Accounts = (() => {
  const KEY = "npay.accounts.v2";
  const SESSION = "npay.session";
  const USED = "npay.used"; // codes already redeemed on this device, by any account
  const OLD_WALLET = "npay.wallet.eur"; // the single wallet from before accounts existed
  const START_BALANCE = 100_00;
  const ITERATIONS = 150_000;

  let all = NPay.store.get(KEY, {});

  function persist() {
    for (const a of Object.values(all)) a.history = a.history.slice(0, 300);
    if (!NPay.store.set(KEY, all)) NPay.toast("Storage is full — try a smaller photo");
  }

  const bytesToHex = (b) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");

  async function hashPassword(password, saltHex) {
    if (crypto.subtle) {
      const salt = Uint8Array.from(saltHex.match(/../g), (h) => parseInt(h, 16));
      const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
      const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS }, key, 256);
      return "pbkdf2$" + bytesToHex(bits);
    }
    // Plain-http fallback (no WebCrypto there). Weak, but this is play money on one device.
    let h = 2166136261;
    for (const ch of saltHex + password) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    return "fnv$" + h.toString(16);
  }

  function normUsername(u) {
    return String(u).trim().replace(/^@/, "").toLowerCase();
  }

  function validUsername(u) {
    return /^[a-z0-9._]{3,20}$/.test(u);
  }

  function list() {
    return Object.values(all).sort((a, b) => (b.lastLogin || 0) - (a.lastLogin || 0));
  }

  function byUsername(u) {
    u = normUsername(u);
    return Object.values(all).find((a) => a.username === u) || null;
  }

  function current() {
    const uid = NPay.store.get(SESSION, null);
    return uid && all[uid] ? all[uid] : null;
  }

  async function create({ name, username, password, pfp = null, color = null }) {
    username = normUsername(username);
    name = String(name).trim();
    if (!name) throw new Error("Enter your name");
    if (!validUsername(username)) throw new Error("Username: 3–20 letters, numbers, dots or underscores");
    if (byUsername(username)) throw new Error(`@${username} is already taken on this device`);
    if (String(password).length < 4) throw new Error("Password needs at least 4 characters");

    const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
    const acc = {
      uid: NPay.newId(16),
      username,
      name: name.slice(0, 40),
      color: color || NPay.colorFor(username),
      pfp,
      salt,
      hash: await hashPassword(password, salt),
      balance: START_BALANCE,
      history: [],
      hide: false,
      created: Date.now(),
      lastLogin: Date.now(),
    };

    // The very first account takes over the wallet from the old, account-less version.
    const old = NPay.store.get(OLD_WALLET, null);
    if (old && !Object.keys(all).length) {
      acc.balance = old.balance;
      acc.history = (old.history || []).map((t) => ({ ...t, kind: t.delta < 0 ? "pay" : "get" }));
      markUsed(...(old.used || []));
      NPay.store.remove(OLD_WALLET);
      acc.migrated = true;
    }

    all[acc.uid] = acc;
    persist();
    NPay.store.set(SESSION, acc.uid);
    return acc;
  }

  async function login(username, password) {
    const acc = byUsername(username);
    if (!acc) throw new Error("No account with that username on this device");
    if ((await hashPassword(password, acc.salt)) !== acc.hash) throw new Error("Wrong password");
    acc.lastLogin = Date.now();
    persist();
    NPay.store.set(SESSION, acc.uid);
    return acc;
  }

  function logout() {
    NPay.store.remove(SESSION);
  }

  async function changePassword(acc, oldPw, newPw) {
    if ((await hashPassword(oldPw, acc.salt)) !== acc.hash) throw new Error("Current password is wrong");
    if (String(newPw).length < 4) throw new Error("New password needs at least 4 characters");
    acc.salt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
    acc.hash = await hashPassword(newPw, acc.salt);
    persist();
  }

  async function remove(acc, password) {
    if ((await hashPassword(password, acc.salt)) !== acc.hash) throw new Error("Wrong password");
    delete all[acc.uid];
    persist();
    logout();
  }

  function isUsed(id) {
    return NPay.store.get(USED, []).includes(id);
  }
  function markUsed(...ids) {
    NPay.store.set(USED, [...NPay.store.get(USED, []), ...ids].slice(-1000));
  }

  // Shrink a picked image to a 256×256 centre-cropped JPEG data URL (~20 KB).
  async function imageToPfp(file) {
    if (!file || !file.type.startsWith("image/")) throw new Error("Pick an image file");
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error("Couldn't read that image"));
        i.src = url;
      });
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const c = document.createElement("canvas");
      c.width = c.height = 256;
      c.getContext("2d").drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
      return c.toDataURL("image/jpeg", 0.85);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  return { START_BALANCE, list, byUsername, current, create, login, logout, changePassword, remove, save: persist, isUsed, markUsed, imageToPfp, normUsername, validUsername };
})();
