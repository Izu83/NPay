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
  const CURRENCY = "NP";

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

  function money(cents) {
    const sign = cents < 0 ? "−" : "";
    const abs = Math.abs(cents);
    return `${sign}${(abs / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${CURRENCY}`;
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

  return { CURRENCY, newId, encodeRequest, decodeRequest, parseScanned, walletUrl, money, parseAmount, store, escapeHtml };
})();
