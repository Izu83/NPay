// NPay terminal — runs on the computer and shows QR codes for the phone to scan.
(() => {
  const VALID_MINUTES = 5;
  const RING = 2 * Math.PI * 9; // circumference of the countdown ring (r = 9)
  const $ = (id) => document.getElementById(id);
  const LOGO = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 20V4h3.6l6.8 9.6V4H19v16h-3.6L8.6 10.4V20z"/></svg>';

  let mode = "pay"; // "pay" = charge the phone, "get" = give money to the phone
  let timer = null;

  $("who").value = NPay.store.get("npay.terminalName", "NPay Shop");
  $("who").addEventListener("change", () => NPay.store.set("npay.terminalName", $("who").value.trim() || "NPay Shop"));

  function setMode(m) {
    mode = m;
    $("seg").dataset.mode = m;
    $("modePay").classList.toggle("on", m === "pay");
    $("modeGet").classList.toggle("on", m === "get");
    $("modePay").setAttribute("aria-selected", m === "pay");
    $("modeGet").setAttribute("aria-selected", m === "get");
    $("modeHelp").textContent = m === "pay" ? "The phone that scans pays this amount." : "The phone that scans receives this amount.";
  }
  $("modePay").onclick = () => setMode("pay");
  $("modeGet").onclick = () => setMode("get");

  document.querySelectorAll("[data-q]").forEach((b) => (b.onclick = () => { $("amount").value = b.dataset.q; $("amount").focus(); }));

  function shakeAmount() {
    const w = $("amountWrap");
    w.classList.remove("shake");
    void w.offsetWidth;
    w.classList.add("shake");
    $("amount").focus();
  }

  function makeQr() {
    const amt = NPay.parseAmount($("amount").value);
    if (!amt) { shakeAmount(); NPay.toast("Enter an amount, like 4.50"); return; }
    if (amt > 1_000_000_00) { shakeAmount(); NPay.toast("That's a bit much — max €1,000,000"); return; }
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

    $("stage").innerHTML = `
      <div class="qr-show">
        <span class="mode-pill ${mode === "get" ? "out" : ""}"><span class="dot"></span>${mode === "pay" ? "Waiting for payment" : "Ready to give"}</span>
        <div class="qr-amount num">${NPay.money(amt)}</div>
        <div class="qr-sub">${NPay.escapeHtml(who)}${req.note ? " · " + NPay.escapeHtml(req.note) : ""}</div>
        <div class="qr-frame" id="qrFrame"><div id="qr"></div><div class="qr-logo"><span>${LOGO}</span></div></div>
        <div class="qr-sub">${mode === "pay" ? "Scan with NPay to pay" : "Scan with NPay to receive"} · one use only</div>
        <div class="timer-ring" id="timerRing">
          <svg viewBox="0 0 22 22" fill="none" stroke-width="3"><circle class="track" cx="11" cy="11" r="9"/><circle class="prog" id="ringProg" cx="11" cy="11" r="9" stroke-linecap="round" stroke-dasharray="${RING}" stroke-dashoffset="0"/></svg>
          <span>Expires in <b class="num" id="timer"></b></span>
        </div>
        <div class="stage-actions">
          <button class="btn ghost" id="copyBtn">Copy link</button>
          <button class="btn ghost" id="newBtn">New code</button>
        </div>
      </div>`;

    // High error correction so the logo in the middle doesn't break scanning.
    new QRCode($("qr"), { text: link, width: 512, height: 512, colorDark: "#0f1712", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.H });

    $("copyBtn").onclick = async () => {
      try { await navigator.clipboard.writeText(link); NPay.toast("Link copied"); } catch { NPay.toast("Couldn't copy"); }
    };
    $("newBtn").onclick = makeQr;

    clearInterval(timer);
    const total = req.exp - Date.now();
    const tick = () => {
      const el = $("timer");
      if (!el) return clearInterval(timer);
      const left = Math.max(0, req.exp - Date.now());
      const m = Math.floor(left / 60000);
      const s = Math.floor((left % 60000) / 1000);
      el.textContent = `${m}:${String(s).padStart(2, "0")}`;
      $("ringProg").setAttribute("stroke-dashoffset", String(RING * (1 - left / total)));
      if (!left) {
        clearInterval(timer);
        el.textContent = "0:00";
        $("timerRing").classList.add("expired");
        $("timerRing").querySelector("span").textContent = "Expired — make a new code";
        $("qrFrame").classList.add("expired");
      }
    };
    tick();
    timer = setInterval(tick, 1000);
  }

  $("makeBtn").onclick = makeQr;
  ["amount", "note", "who"].forEach((id) => $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") makeQr(); }));
  $("amount").focus();
})();
