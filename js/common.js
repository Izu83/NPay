// NPay — shared helpers used by both the wallet (phone) and the terminal (computer).
//
// A QR code holds a link like  https://<you>.github.io/NPay/#r=<payload>
// so it can be scanned from inside the wallet OR with the phone's normal camera app.
//
// Payload (JSON, base64url encoded), always { v: 1, t: <type>, ... }:
//
//   t: "pay"   terminal charge   -> the scanner PAYS   { id, amt, who, note?, exp }
//   t: "get"   terminal payout   -> the scanner GETS   { id, amt, who, note?, exp }
//   t: "user"  an account's own code (send money to them)
//              { uid, u: username, n: name, c: avatar colour, amt?, note? }
//   t: "xfer"  a claim code made after sending money to someone;
//              only the account it is addressed to can take it
//              { id, amt, who: sender name, fu: sender username, to: recipient uid, note?, exp }
//
// amt is always in cents (integer).

const NPay = (() => {
  const CURRENCY = "EUR";
  const COLORS = ["#32292f", "#2a9d8f", "#0f766e", "#2563eb", "#475569", "#ea580c", "#e11d48", "#b45309"];

  function toB64Url(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    bytes.forEach((b) => (bin += String.fromCharCode(b)));
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function fromB64Url(s) {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    const bin = atob(s);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function newId(len = 14) {
    const a = new Uint8Array(len);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, len);
  }

  function encodeRequest(req) {
    const clean = {};
    for (const [k, v] of Object.entries(req)) if (v !== undefined && v !== "") clean[k] = v;
    return toB64Url(JSON.stringify({ v: 1, ...clean }));
  }

  const isStr = (x) => typeof x === "string" && x.length > 0;
  const isAmt = (x) => Number.isInteger(x) && x > 0;

  function decodeRequest(encoded) {
    try {
      const o = JSON.parse(fromB64Url(encoded));
      if (o.v !== 1) return null;
      if (o.t === "pay" || o.t === "get") return isAmt(o.amt) && isStr(o.id) && isStr(o.who) ? o : null;
      if (o.t === "user") return isStr(o.uid) && isStr(o.u) && isStr(o.n) && (o.amt === undefined || isAmt(o.amt)) ? o : null;
      if (o.t === "xfer") return isAmt(o.amt) && isStr(o.id) && isStr(o.who) && isStr(o.to) ? o : null;
      return null;
    } catch {
      return null;
    }
  }

  // Pull the payload out of whatever text the QR contained (full link or bare payload).
  function parseScanned(text) {
    const m = String(text).match(/[#&?]r=([A-Za-z0-9_-]+)/);
    return decodeRequest(m ? m[1] : String(text).trim());
  }

  // Base URL of the wallet page (index.html) next to the current page.
  function walletUrl() {
    const u = new URL("./", location.href);
    u.hash = "";
    u.search = "";
    return u.href;
  }

  function linkFor(req) {
    return walletUrl() + "#r=" + encodeRequest(req);
  }

  const fmt = new Intl.NumberFormat(undefined, { style: "currency", currency: CURRENCY });

  // money(1250) -> "€12.50" (format follows the device's language, e.g. "12,50 €")
  // money(-1250, true) -> "−€12.50", money(1250, true) -> "+€12.50"
  function money(cents, withSign = false) {
    const s = fmt.format(Math.abs(cents) / 100);
    if (cents < 0) return "−" + s;
    return withSign && cents > 0 ? "+" + s : s;
  }

  // Parse "12", "12.5", "12,50" into cents. Returns null if invalid.
  function parseAmount(str) {
    const s = String(str).trim().replace(",", ".");
    if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
    const cents = Math.round(parseFloat(s) * 100);
    return cents > 0 ? cents : null;
  }

  // localStorage wrapper that never throws.
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v === null ? fallback : JSON.parse(v);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
    remove(key) {
      try { localStorage.removeItem(key); } catch {}
    },
  };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function initials(name) {
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    return ((parts[0]?.[0] || "N") + (parts[1]?.[0] || "")).toUpperCase();
  }

  // Pick a stable colour for a name/id that has none.
  function colorFor(seed) {
    let h = 0;
    for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return COLORS[h % COLORS.length];
  }

  // Fill an element with a profile picture, or initials on a coloured disc.
  function paintAvatar(el, { name = "", pfp = null, color = null } = {}) {
    el.classList.add("avatar");
    el.style.background = pfp ? "" : color || colorFor(name);
    el.style.color = pfp ? "" : "#fff";
    if (pfp) {
      el.innerHTML = "";
      const img = new Image();
      img.alt = "";
      img.src = pfp;
      el.appendChild(img);
    } else {
      el.textContent = initials(name);
    }
  }

  // Smoothly count a money value from one amount to another.
  function animateMoney(el, from, to, ms = 700) {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || from === to) {
      el.textContent = money(to);
      return;
    }
    const start = performance.now();
    cancelAnimationFrame(el._raf);
    const step = (now) => {
      const p = Math.min(1, (now - start) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = money(Math.round(from + (to - from) * e));
      if (p < 1) el._raf = requestAnimationFrame(step);
    };
    el._raf = requestAnimationFrame(step);
  }

  function toast(msg) {
    let t = document.getElementById("toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "toast";
      t.className = "toast";
      t.setAttribute("role", "status");
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove("show"), 2400);
  }

  // Draw a QR code into `el` as a canvas (needs qrcode-generator). High error correction so
  // a logo or photo in the middle doesn't stop it from scanning; drops a level only if the
  // text is too long for it.
  function drawQr(el, text, size = 512) {
    el.innerHTML = "";
    if (!window.qrcode) { el.innerHTML = '<p style="line-height:1.4;color:#32292f;padding:20px">Couldn\'t load the QR maker. Check your connection and reload.</p>'; return null; }
    let qr = null;
    for (const level of ["H", "Q", "M", "L"]) {
      try { qr = qrcode(0, level); qr.addData(text, "Byte"); qr.make(); break; } catch { qr = null; }
    }
    if (!qr) return null;
    const n = qr.getModuleCount();
    const quiet = 2;
    const cell = Math.max(1, Math.floor(size / (n + quiet * 2)));
    const px = cell * (n + quiet * 2);
    const c = document.createElement("canvas");
    c.width = c.height = px;
    c.setAttribute("role", "img");
    c.setAttribute("aria-label", "QR code");
    const g = c.getContext("2d");
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, px, px);
    g.fillStyle = "#32292f";
    for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) {
      if (qr.isDark(r, col)) g.fillRect((col + quiet) * cell, (r + quiet) * cell, cell, cell);
    }
    el.appendChild(c);
    return c;
  }

  // Theme: "system" | "light" | "dark", stored per device.
  function applyTheme(theme = store.get("npay.theme", "system")) {
    if (theme === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
    const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#1b1519" : "#e8f3f1");
  }
  applyTheme();

  return {
    CURRENCY, COLORS, newId, initials, colorFor, paintAvatar, animateMoney, toast,
    encodeRequest, decodeRequest, parseScanned, walletUrl, linkFor, money, parseAmount,
    store, escapeHtml, drawQr, applyTheme,
  };
})();
