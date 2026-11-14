// NPay terminal — runs on the computer and shows QR codes for the phone to scan.
(() => {
  const VALID_MINUTES = 5;
  const $ = (id) => document.getElementById(id);

  let mode = "pay"; // "pay" = charge the phone, "get" = give money to the phone
  let timer = null;

  $("who").value = NPay.store.get("npay.terminalName", "NPay Shop");
  $("who").addEventListener("change", () => NPay.store.set("npay.terminalName", $("who").value.trim() || "NPay Shop"));

  function setMode(m) {
    mode = m;
    $("modePay").classList.toggle("on", m === "pay");
    $("modeGet").classList.toggle("on", m === "get");
    $("modeHelp").textContent = m === "pay" ? "The phone that scans pays this amount." : "The phone that scans receives this amount.";
  }
  $("modePay").onclick = () => setMode("pay");
  $("modeGet").onclick = () => setMode("get");

  document.querySelectorAll("[data-q]").forEach((b) => (b.onclick = () => { $("amount").value = b.dataset.q; $("amount").focus(); }));

  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove("show"), 2600);
  }

  function makeQr() {
    const amt = NPay.parseAmount($("amount").value);
    if (!amt) { toast("Enter an amount, like 4.50"); $("amount").focus(); return; }
    const who = $("who").value.trim() || "NPay Shop";
    NPay.store.set("npay.terminalName", who);

    const req = {
      t: mode,
      id: NPay.newId(),
      amt,
      who,
      note: $("note").value.trim() || undefined,
      exp: Date.now() + VALID_MINUTES * 60 * 1000,
    };
    const link = NPay.walletUrl() + "#r=" + NPay.encodeRequest(req);

    const stage = $("stage");
    stage.innerHTML = `
      <span class="mode-pill ${mode === "get" ? "out" : ""}">${mode === "pay" ? "Charge" : "Give money"}</span>
      <div class="qr-amount">${NPay.money(amt)}</div>
      <div class="qr-sub">${NPay.escapeHtml(who)}${req.note ? " · " + NPay.escapeHtml(req.note) : ""}</div>
      <div class="qr-box" id="qr"></div>
      <div class="qr-title">${mode === "pay" ? "Scan with NPay to pay" : "Scan with NPay to receive"}</div>
      <div class="qr-sub">Expires in <span class="qr-timer" id="timer"></span> · one use only</div>
      <div class="actions two" style="margin-top:10px;width:min(360px,100%)">
        <button class="btn" id="copyBtn">Copy link</button>
        <button class="btn" id="newBtn">New code</button>
      </div>`;

    new QRCode($("qr"), { text: link, width: 512, height: 512, correctLevel: QRCode.CorrectLevel.M });

    $("copyBtn").onclick = async () => {
      try { await navigator.clipboard.writeText(link); toast("Link copied"); } catch { toast("Couldn't copy"); }
    };
    $("newBtn").onclick = makeQr;

    clearInterval(timer);
    const tick = () => {
      const left = Math.max(0, req.exp - Date.now());
      const el = $("timer");
      if (!el) return clearInterval(timer);
      const m = Math.floor(left / 60000);
      const s = Math.floor((left % 60000) / 1000);
      el.textContent = `${m}:${String(s).padStart(2, "0")}`;
      if (!left) {
        el.textContent = "expired";
        el.classList.add("expired");
        $("qr").style.opacity = "0.15";
        clearInterval(timer);
      }
    };
    tick();
    timer = setInterval(tick, 1000);
  }

  $("makeBtn").onclick = makeQr;
  $("amount").addEventListener("keydown", (e) => { if (e.key === "Enter") makeQr(); });
  $("note").addEventListener("keydown", (e) => { if (e.key === "Enter") makeQr(); });
})();
