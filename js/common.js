// NPay — shared helpers used by both the wallet (phone) and the terminal (computer).
//
// A QR code holds a link like  https://<you>.github.io/NPay/#r=<payload>
// so it can be scanned from inside the wallet OR with the phone's normal camera app.
//
// Payload (JSON, base64url encoded):
//   v    version (1)
//   t    "pay"  -> the scanner PAYS money to the terminal (a charge)
//        "get"  -> the scanner RECEIVES money from the terminal (a payout)
//   id   unique id, so the same QR can't be used twice
//   amt  amount in cents (integer)
//   who  name of the terminal / shop
//   note optional text
//   exp  expiry time (ms since epoch)

const NPay = (() => {
  const CURRENCY = "EUR";

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

  function newId() {
    const a = new Uint8Array(9);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 14);
  }

  function encodeRequest(req) {
    return toB64Url(JSON.stringify({ v: 1, ...req }));
  }

  function decodeRequest(encoded) {
    try {
      const obj = JSON.parse(fromB64Url(encoded));
      if (obj.v !== 1) return null;
      if (obj.t !== "pay" && obj.t !== "get") return null;
      if (!Number.isInteger(obj.amt) || obj.amt <= 0) return null;
      if (typeof obj.id !== "string" || typeof obj.who !== "string") return null;
      return obj;
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
      } catch {}
    },
  };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function initials(name) {
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    return ((parts[0]?.[0] || "N") + (parts[1]?.[0] || "")).toUpperCase();
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
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove("show"), 2400);
  }

  return { CURRENCY, newId, initials, animateMoney, toast, encodeRequest, decodeRequest, parseScanned, walletUrl, money, parseAmount, store, escapeHtml };
})();
