// NPay terminal — runs on the computer. You sign in with your NPay account; a "Charge" code
// is paid into your account, a "Give money" code is paid out of it. The screen updates by
// itself the moment a phone pays.
(() => {
  const VALID_MINUTES = 5;
  const RING = 2 * Math.PI * 9; // circumference of the countdown ring (r = 9)
  const $ = (id) => document.getElementById(id);
  const LOGO = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 20V4h3.6l6.8 9.6V4H19v16h-3.6L8.6 10.4V20z"/></svg>';
  const EMPTY_STAGE = $("stage").innerHTML;

  let me = null;
  let mode = "pay"; // "pay" = charge the phone, "get" = give money to the phone
  let timer = null;
  let current = null;      // the open payment request on screen
  let stopWatch = null;
  let stopTx = null;
  let sales = [];

  // ---------------- Sign in ----------------
  async function boot() {
    if (!Backend.configured) return showSignin(true);
    try { me = await Backend.loadMe(); } catch (err) { NPay.toast(err.message); me = null; }
    if (!me) return showSignin(false);

    $("termSignin").hidden = true;
    $("termGrid").hidden = false;
    $("termMe").hidden = false;
    renderMe();
    $("who").value = NPay.store.get("npay.terminalName", "") || me.name;
    loadSales();
    stopTx?.();
    stopTx = Backend.onTransaction((row) => {
      if (row.kind === "charge" || row.kind === "payout") { sales.unshift(row); renderSales(row.id); }
      Backend.refreshBalance().then(renderMe).catch(() => {});
    });
    $("amount").focus();
  }

  function showSignin(notConfigured) {
    $("termSignin").hidden = false;
    $("termGrid").hidden = true;
    $("termMe").hidden = true;
    $("termSetup").hidden = !notConfigured;
    $("tsForm").hidden = notConfigured;
  }

  function renderMe() {
    NPay.paintAvatar($("tmAvatar"), me);
    $("tmName").textContent = me.name;
    $("tmBalance").textContent = NPay.money(me.balance);
  }

  $("tsForm").onsubmit = async (e) => {
    e.preventDefault();
    $("tsErr").textContent = "";
    const btn = $("tsBtn");
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Signing in…';
    try {
      await Backend.signIn($("tsEmail").value, $("tsPass").value);
      $("tsPass").value = "";
      await boot();
    } catch (err) {
      $("tsErr").textContent = err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = "Sign in";
    }
  };

  $("tmSignOut").onclick = async () => {
    reset();
    stopTx?.();
    await Backend.signOut();
    me = null;
    showSignin(false);
  };

  // ---------------- Today's sales ----------------
  async function loadSales() {
    try {
      const rows = await Backend.history(100);
      const today = new Date().toDateString();
      sales = rows.filter((r) => (r.kind === "charge" || r.kind === "payout") && new Date(r.created_at).toDateString() === today);
      renderSales();
    } catch (err) { NPay.toast(err.message); }
  }

  function renderSales(newId) {
    const total = sales.reduce((s, r) => s + r.amount, 0);
    $("salesTotal").textContent = sales.length ? NPay.money(total, true) : "";
    if (!sales.length) {
      $("sales").innerHTML = '<div class="empty">No payments yet today.</div>';
      return;
    }
    $("sales").innerHTML = "";
    sales.slice(0, 12).forEach((r, i) => {
      const row = document.createElement("div");
      row.className = "tx" + (i === 0 && newId === r.id ? " new" : "");
      const time = new Date(r.created_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
      row.innerHTML = `<span class="avatar sm"></span>
        <span class="tx-main"><span class="tx-who">${NPay.escapeHtml(r.other_name)}</span>
        <span class="tx-meta">${r.kind === "charge" ? "Paid you" : "You gave"} · ${time}${r.note ? " · " + NPay.escapeHtml(r.note) : ""}</span></span>
        <span class="tx-amt num ${r.amount > 0 ? "in" : ""}">${NPay.money(r.amount, true)}</span>`;
      NPay.paintAvatar(row.querySelector(".avatar"), { name: r.other_name, color: r.other_color });
      $("sales").appendChild(row);
    });
  }

  // ---------------- Making a code ----------------
  function setMode(m) {
    mode = m;
    $("seg").dataset.mode = m;
    $("modePay").classList.toggle("on", m === "pay");
    $("modeGet").classList.toggle("on", m === "get");
    $("modePay").setAttribute("aria-selected", m === "pay");
    $("modeGet").setAttribute("aria-selected", m === "get");
    $("modeHelp").textContent = m === "pay" ? "The phone that scans pays you this amount." : "The phone that scans gets this amount from your balance.";
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

  // Close the code on screen (and stop listening for it).
  function reset() {
    clearInterval(timer);
    stopWatch?.();
    stopWatch = null;
    if (current?.status === "open") Backend.cancelRequest(current.id);
    current = null;
  }

  async function makeQr() {
    const amt = NPay.parseAmount($("amount").value);
    if (!amt) { shakeAmount(); NPay.toast("Enter an amount, like 4.50"); return; }
    if (amt > 1_000_000_00) { shakeAmount(); NPay.toast("That's a bit much — max €1,000,000"); return; }
    if (mode === "get" && amt > me.balance) { shakeAmount(); NPay.toast(`You only have ${NPay.money(me.balance)} to give`); return; }
    const who = $("who").value.trim() || me.name;
    NPay.store.set("npay.terminalName", who);
    const note = $("note").value.trim();

    const btn = $("makeBtn");
    btn.disabled = true;
    reset();
    let req;
    try {
      req = await Backend.createRequest(mode, amt, who, note);
    } catch (err) {
      NPay.toast(err.message);
      return;
    } finally {
      btn.disabled = false;
    }
    current = req;
    const link = NPay.linkFor({ t: "req", id: req.id });
    const kind = req.kind;

    $("stage").innerHTML = `
      <div class="qr-show">
        <span class="mode-pill ${kind === "get" ? "out" : ""}"><span class="dot"></span>${kind === "pay" ? "Waiting for payment" : "Ready to give"}</span>
        <div class="qr-amount num">${NPay.money(amt)}</div>
        <div class="qr-sub">${NPay.escapeHtml(who)}${note ? " · " + NPay.escapeHtml(note) : ""}</div>
        <div class="qr-frame" id="qrFrame"><div id="qr"></div><div class="qr-logo"><span>${LOGO}</span></div></div>
        <div class="qr-sub">${kind === "pay" ? "Scan with NPay to pay" : "Scan with NPay to receive"} · one use only</div>
        <div class="timer-ring" id="timerRing">
          <svg viewBox="0 0 22 22" fill="none" stroke-width="3"><circle class="track" cx="11" cy="11" r="9"/><circle class="prog" id="ringProg" cx="11" cy="11" r="9" stroke-linecap="round" stroke-dasharray="${RING}" stroke-dashoffset="0"/></svg>
          <span>Expires in <b class="num" id="timer"></b></span>
        </div>
        <div class="stage-actions">
          <button class="btn ghost" id="copyBtn">Copy link</button>
          <button class="btn ghost" id="cancelBtn">Cancel</button>
        </div>
      </div>`;

    NPay.drawQr($("qr"), link, 512);

    $("copyBtn").onclick = async () => {
      try { await navigator.clipboard.writeText(link); NPay.toast("Link copied"); } catch { NPay.toast("Couldn't copy"); }
    };
    $("cancelBtn").onclick = () => { reset(); $("stage").innerHTML = EMPTY_STAGE; NPay.toast("Code cancelled"); };

    // The moment a phone pays, the database tells us.
    stopWatch = Backend.watchRequest(req.id, (row) => {
      if (!current || row.id !== current.id || row.status !== "done") return;
      showPaid({ ...current, ...row });
    });

    const exp = new Date(req.expires_at).getTime();
    const total = exp - Date.now();
    const tick = () => {
      const el = $("timer");
      if (!el) return clearInterval(timer);
      const left = Math.max(0, exp - Date.now());
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
        stopWatch?.();
        if (current) current.status = "expired";
      }
    };
    tick();
    timer = setInterval(tick, 1000);
  }

  function showPaid(r) {
    clearInterval(timer);
    stopWatch?.();
    stopWatch = null;
    current = null;
    const charged = r.kind === "pay";
    $("stage").innerHTML = `
      <div class="paid-show">
        <div class="check">
          <svg viewBox="0 0 104 104" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
            <circle class="ring" cx="52" cy="52" r="46" opacity="0.35"/><path class="mark" d="M34 53l12 12 24-26"/>
          </svg>
        </div>
        <div class="qr-amount num">${NPay.money(r.amount)}</div>
        <div class="paid-title">${charged ? "Paid by" : "Given to"} ${NPay.escapeHtml(r.paid_by_name || "a customer")}</div>
        <div class="qr-sub">${NPay.escapeHtml(r.label)}${r.note ? " · " + NPay.escapeHtml(r.note) : ""} · ${new Date(r.paid_at || Date.now()).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</div>
        <div class="stage-actions single"><button class="btn primary" id="nextBtn">Next payment</button></div>
      </div>`;
    $("nextBtn").onclick = () => { $("stage").innerHTML = EMPTY_STAGE; $("amount").value = ""; $("note").value = ""; $("amount").focus(); };
    $("nextBtn").focus();
    Backend.refreshBalance().then(renderMe).catch(() => {});
  }

  $("makeBtn").onclick = makeQr;
  ["amount", "note", "who"].forEach((id) => $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") makeQr(); }));
  window.addEventListener("pagehide", () => { if (current?.status === "open") Backend.cancelRequest(current.id); });
  Backend.onAuthChange?.((event) => { if (event === "SIGNED_OUT" && me) { reset(); me = null; showSignin(false); } });

  boot();
})();
