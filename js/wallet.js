// NPay wallet — runs on the phone. Accounts, balances and payments live in Supabase
// (see js/backend.js); this file is the screens.
(() => {
  const $ = (id) => document.getElementById(id);
  const PENDING = "npay.pendingLink";
  const LOGO = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 20V4h3.6l6.8 9.6V4H19v16h-3.6L8.6 10.4V20z"/></svg>';
  const ICON_OUT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7M9 7h8v8"/></svg>';
  const ICON_IN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M17 7L7 17M15 17H7V9"/></svg>';
  const EYE_OPEN = '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>';
  const EYE_SHUT = '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/>';
  const KIND_LABEL = { pay: "Paid", get: "Received", send: "Sent", recv: "Received", charge: "Sale", payout: "Paid out" };
  const KIND_TITLE = { pay: "You paid", get: "You received from", send: "You sent to", recv: "You received from", charge: "Your terminal was paid by", payout: "Your terminal paid out to" };

  let me = null;          // Backend.me: { id, email, username, name, color, avatar, balance, created_at }
  let history = [];       // rows from the transactions table, newest first
  let shownBalance = 0;
  let filter = "all";
  let hide = NPay.store.get("npay.hide", false);
  let friendsList = [];   // rows from my_friends(): friends and requests in/out
  let chatWith = null;    // the friend whose chat is open

  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ================= Views =================
  async function boot() {
    if (!Backend.configured) {
      showAuth();
      $("setupNote").hidden = false;
      $("authCard").hidden = true;
      return;
    }
    try { me = await Backend.loadMe(); } catch (err) { me = null; NPay.toast(err.message); }
    if (!me) return showAuth();

    $("authView").hidden = true;
    $("appView").hidden = false;
    shownBalance = me.balance;
    renderHeader();
    renderBalance(false);
    renderHistory();

    // The PIN: choose one if there's none yet (or after "Forgot PIN"), otherwise ask for
    // it, unless the password was typed in this tab a moment ago.
    const fresh = sessionStorage.getItem("npay.fresh") === me.id;
    const reset = sessionStorage.getItem("npay.resetPin") === "1";
    sessionStorage.removeItem("npay.fresh");
    sessionStorage.removeItem("npay.resetPin");
    let hasPin = true;
    try { hasPin = await Backend.hasPin(); } catch (err) { NPay.toast(err.message); }
    if (!hasPin || reset) {
      await Lock.setup(me, { required: true, reset });
      NPay.toast(reset ? "New PIN saved" : "PIN saved");
      await offerBio();
    } else if (!fresh) {
      await Lock.unlock(me, { onForgot: forgotPin });
    }

    reloadHistory();
    refreshFriends();
    startLive();

    const pend = sessionStorage.getItem(PENDING);
    if (pend) { sessionStorage.removeItem(PENDING); setTimeout(() => handleRequest(NPay.parseScanned(pend)), 400); }
  }

  function showAuth() {
    Backend.unsubscribeAll();
    me = null;
    friendsList = [];
    Lock.hide();
    $("authView").hidden = false;
    $("appView").hidden = true;
    paintSignupAvatar();
  }

  async function reloadHistory() {
    try {
      history = await Backend.history(100);
      renderMonth();
      renderHistory();
    } catch (err) {
      NPay.toast(err.message);
    }
  }

  // Money arriving from someone else shows up straight away.
  function startLive() {
    Backend.unsubscribeAll();
    Backend.onMessage(onIncomingMessage);
    Backend.onFriendship(() => refreshFriends(true));
    Backend.onTransaction(async (row) => {
      if (chatWith && row.other_id === chatWith.user_id && (row.kind === "send" || row.kind === "recv")) appendChatItem(paymentItem(row));
      if (history.some((t) => t.id === row.id)) return;
      history.unshift(row);
      await Backend.refreshBalance().catch(() => {});
      renderBalance(true);
      renderMonth();
      renderHistory(row.id);
      if (row.amount > 0 && (row.kind === "recv" || row.kind === "charge")) {
        if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
        NPay.toast(`${NPay.money(row.amount, true)} from ${row.other_name}`);
      }
    });
  }

  // ================= Auth =================
  let suAvatar = null;

  function setAuthTab(tab) {
    const up = tab === "up";
    $("authSeg").dataset.mode = up ? "b" : "a";
    $("tabIn").classList.toggle("on", !up);
    $("tabUp").classList.toggle("on", up);
    $("tabIn").setAttribute("aria-selected", !up);
    $("tabUp").setAttribute("aria-selected", up);
    $("loginForm").hidden = up;
    $("signupForm").hidden = !up;
    $("liErr").textContent = $("suErr").textContent = "";
  }

  function paintSignupAvatar() {
    const name = $("suName").value.trim();
    const el = $("suAvatar");
    if (suAvatar || name) NPay.paintAvatar(el, { name, pfp: suAvatar, color: NPay.colorFor($("suUser").value || name) });
    else { el.style.background = ""; el.style.color = ""; el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="9" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>'; }
  }

  async function busy(btn, label, fn) {
    const text = btn.textContent;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>${label}`;
    try { await fn(); } finally { btn.disabled = false; btn.textContent = text; }
  }

  function shake(el) {
    el.classList.remove("shake");
    void el.offsetWidth;
    el.classList.add("shake");
  }

  $("tabIn").onclick = () => setAuthTab("in");
  $("tabUp").onclick = () => setAuthTab("up");
  document.querySelectorAll("[data-reveal]").forEach((b) => {
    b.onclick = () => {
      const inp = $(b.dataset.reveal);
      const show = inp.type === "password";
      inp.type = show ? "text" : "password";
      b.textContent = show ? "Hide" : "Show";
      b.setAttribute("aria-label", show ? "Hide password" : "Show password");
    };
  });
  $("suName").addEventListener("input", () => {
    paintSignupAvatar();
    // Suggest a username from the name until the user types their own.
    if (!$("suUser").dataset.touched) $("suUser").value = $("suName").value.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "").slice(0, 20);
  });
  $("suUser").addEventListener("input", () => { $("suUser").dataset.touched = "1"; paintSignupAvatar(); });
  $("suPhoto").addEventListener("change", async (e) => {
    try { suAvatar = await NPay.imageToAvatar(e.target.files[0]); paintSignupAvatar(); } catch (err) { NPay.toast(err.message); }
    e.target.value = "";
  });

  function authNote(text) {
    $("authNote").textContent = text || "";
    $("authNote").hidden = !text;
  }

  $("loginForm").onsubmit = (e) => {
    e.preventDefault();
    $("liErr").textContent = "";
    authNote("");
    const email = $("liEmail").value.trim();
    if (!email || !$("liPass").value) { $("liErr").textContent = "Enter your email and password"; shake($("loginForm")); return; }
    busy($("liBtn"), "Signing in…", async () => {
      try {
        await Backend.signIn(email, $("liPass").value);
        sessionStorage.setItem("npay.fresh", Backend.me.id);
        $("liPass").value = "";
        await boot();
        NPay.toast(`Welcome back, ${me.name.split(" ")[0]}`);
      } catch (err) {
        $("liErr").textContent = err.message;
        shake($("loginForm"));
      }
    });
  };

  $("signupForm").onsubmit = (e) => {
    e.preventDefault();
    $("suErr").textContent = "";
    authNote("");
    const name = $("suName").value.trim();
    const username = $("suUser").value.trim().replace(/^@/, "").toLowerCase();
    const email = $("suEmail").value.trim();
    const password = $("suPass").value;
    const err = !name ? "Enter your name"
      : !/^[a-z0-9._]{3,20}$/.test(username) ? "Username: 3–20 letters, numbers, dots or underscores"
      : !/^\S+@\S+\.\S+$/.test(email) ? "Enter a valid email"
      : password.length < 6 ? "Password needs at least 6 characters" : "";
    if (err) { $("suErr").textContent = err; shake($("signupForm")); return; }

    busy($("suBtn"), "Creating…", async () => {
      try {
        await Backend.signUp({ email, password, username, name, color: NPay.colorFor(username), avatar: suAvatar });
        sessionStorage.setItem("npay.fresh", Backend.me.id);
        suAvatar = null;
        ["suName", "suUser", "suEmail", "suPass"].forEach((id) => ($(id).value = ""));
        delete $("suUser").dataset.touched;
        await boot();
        NPay.toast(`Welcome to NPay, ${me.name.split(" ")[0]}`);
      } catch (e2) {
        if (e2.code === "confirm") {
          setAuthTab("in");
          $("liEmail").value = email;
          authNote(e2.message);
        } else {
          $("suErr").textContent = e2.message;
          shake($("signupForm"));
        }
      }
    });
  };

  // ================= Home rendering =================
  function greeting() {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  }

  function renderHeader() {
    $("greeting").textContent = greeting();
    $("ownerName").textContent = me.name;
    NPay.paintAvatar($("avatar"), me);
    $("bcUser").textContent = "@" + me.username;
    $("balance").classList.toggle("hidden", hide);
    $("eyeIcon").innerHTML = hide ? EYE_SHUT : EYE_OPEN;
    $("eyeBtn").setAttribute("aria-label", hide ? "Show balance" : "Hide balance");
  }

  function renderBalance(animate) {
    const el = $("balance");
    if (animate && !reduced()) {
      NPay.animateMoney(el, shownBalance, me.balance, 900);
      el.classList.remove("bump");
      void el.offsetWidth;
      el.classList.add("bump");
    } else {
      el.textContent = NPay.money(me.balance);
    }
    shownBalance = me.balance;
  }

  function renderMonth() {
    const now = new Date();
    let inn = 0, out = 0;
    for (const tx of history) {
      const d = new Date(tx.created_at);
      if (d.getMonth() !== now.getMonth() || d.getFullYear() !== now.getFullYear()) continue;
      if (tx.amount > 0) inn += tx.amount; else out -= tx.amount;
    }
    $("mIn").textContent = NPay.money(inn, true);
    $("mOut").textContent = out ? NPay.money(-out) : NPay.money(0);
    const total = inn + out;
    $("mBarIn").style.flexGrow = total ? inn : 1;
    $("mBarOut").style.flexGrow = total ? out : 1;
    $("mBarIn").parentElement.classList.toggle("is-empty", !total);
  }

  function dayLabel(ts) {
    const d = new Date(ts);
    const today = new Date();
    const y = new Date(); y.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return "Today";
    if (d.toDateString() === y.toDateString()) return "Yesterday";
    return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "long", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
  }

  const txAvatar = (tx) => ({ name: tx.other_name, color: tx.other_color || NPay.colorFor(tx.other_name) });

  function renderHistory(newId) {
    const h = $("history");
    const items = history.filter((t) => filter === "all" || (filter === "in" ? t.amount > 0 : t.amount < 0));
    if (!items.length) {
      h.innerHTML = `<div class="empty">${history.length
        ? "Nothing here with this filter."
        : "<b>No payments yet.</b><br>Scan a shop's code to pay, or show your code to get paid."}</div>`;
      return;
    }
    let lastDay = "";
    h.innerHTML = "";
    items.forEach((tx, i) => {
      const day = dayLabel(tx.created_at);
      if (day !== lastDay) {
        const d = document.createElement("div");
        d.className = "day";
        d.textContent = day;
        h.appendChild(d);
        lastDay = day;
      }
      const incoming = tx.amount > 0;
      const time = new Date(tx.created_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
      const row = document.createElement("button");
      row.className = "tx" + (tx.id === newId ? " new" : "");
      row.style.animationDelay = Math.min(i, 10) * 0.03 + "s";
      row.innerHTML = `
        <span class="tx-avatar"><span class="avatar sm"></span><span class="tx-dir ${incoming ? "in" : ""}">${incoming ? ICON_IN : ICON_OUT}</span></span>
        <span class="tx-main">
          <span class="tx-who">${NPay.escapeHtml(tx.other_name)}</span>
          <span class="tx-meta">${KIND_LABEL[tx.kind] || ""} · ${time}${tx.note ? " · " + NPay.escapeHtml(tx.note) : ""}</span>
        </span>
        <span class="tx-amt num ${incoming ? "in" : ""}">${NPay.money(tx.amount, true)}</span>`;
      NPay.paintAvatar(row.querySelector(".avatar"), txAvatar(tx));
      row.onclick = () => openTx(tx);
      h.appendChild(row);
    });
  }

  document.querySelectorAll(".chip[data-f]").forEach((c) => {
    c.onclick = () => {
      filter = c.dataset.f;
      document.querySelectorAll(".chip[data-f]").forEach((x) => { x.classList.toggle("on", x === c); x.setAttribute("aria-pressed", x === c); });
      renderHistory();
    };
  });

  // ================= Sheets & screens =================
  let openSheetId = null;
  function openSheet(id) {
    if (openSheetId && openSheetId !== id) $(openSheetId).classList.remove("open");
    openSheetId = id;
    $("backdrop").classList.add("open");
    $(id).classList.add("open");
    setTimeout(() => $(id).querySelector("input:not([readonly]), .btn.primary")?.focus({ preventScroll: true }), 420);
  }
  function closeSheet() {
    if (!openSheetId) return;
    $(openSheetId).classList.remove("open");
    $("backdrop").classList.remove("open");
    openSheetId = null;
    pending = null;
  }
  $("backdrop").onclick = closeSheet;

  function openScreen(id) { $(id).classList.add("open"); $(id).setAttribute("aria-hidden", "false"); }
  function closeScreen(id) { $(id).classList.remove("open"); $(id).setAttribute("aria-hidden", "true"); }
  const isOpen = (id) => $(id).classList.contains("open");

  // Swipe a sheet down to close it.
  document.querySelectorAll(".sheet").forEach((sheet) => {
    let startY = null, dy = 0;
    sheet.addEventListener("touchstart", (e) => { if (e.target.closest("input,button")) return; startY = e.touches[0].clientY; dy = 0; sheet.style.transition = "none"; }, { passive: true });
    sheet.addEventListener("touchmove", (e) => { if (startY === null) return; dy = Math.max(0, e.touches[0].clientY - startY); sheet.style.transform = `translateY(${dy}px)`; }, { passive: true });
    sheet.addEventListener("touchend", () => {
      if (startY === null) return;
      sheet.style.transition = ""; sheet.style.transform = "";
      if (dy > 90) closeSheet();
      startY = null;
    });
  });

  // ================= Handling a scanned code =================
  let pending = null;

  function fail(title, amount = "", text = "") {
    showResult({ ok: false, title, amount, text });
  }

  async function handleRequest(req) {
    if (!req) return fail("Not an NPay code", "", "This QR code isn't an NPay code.");
    if (req.t === "user") return startSend(req);
    if (req.t !== "req") return fail("Old NPay code", "", "This code is from the old offline version of NPay. Ask for a new one.");

    NPay.toast("Checking code…");
    let r;
    try { r = await Backend.getRequest(req.id); } catch (err) { return fail("Couldn't check the code", "", err.message); }
    if (!r) return fail("Code not found", "", "This code doesn't exist. Ask for a new one.");
    if (r.owner_id === me.id) return fail("That's your own code", NPay.money(r.amount), "Scan it with another account.");
    if (r.status === "done") return fail("Already used", NPay.money(r.amount), "This code was already paid. Ask for a new one.");
    if (r.status !== "open" || new Date(r.expires_at) < new Date()) return fail("Code expired", NPay.money(r.amount), "This code is no longer valid. Ask for a new one.");

    pending = r;
    const paying = r.kind === "pay";
    const after = me.balance + (paying ? -r.amount : r.amount);
    const tooPoor = paying && after < 0;

    NPay.paintAvatar($("cAvatar"), { name: r.label, avatar: r.owner_avatar, color: r.owner_color });
    $("cKind").textContent = paying ? "You're paying" : "You're receiving from";
    $("cWho").textContent = r.label + (r.label.toLowerCase() !== r.owner_name.toLowerCase() ? ` · @${r.owner_username}` : "");
    $("cAmount").textContent = NPay.money(r.amount);
    $("cNote").textContent = r.note || "";
    $("cNote").style.display = r.note ? "" : "none";
    $("cNow").textContent = NPay.money(me.balance);
    $("cAfter").innerHTML = tooPoor ? '<span class="warn">Not enough money</span>' : NPay.money(after);
    $("cOk").textContent = paying ? `Pay ${NPay.money(r.amount)}` : `Take ${NPay.money(r.amount)}`;
    $("cOk").disabled = tooPoor;
    openSheet("confirmSheet");
  }

  async function confirmPending() {
    const r = pending;
    if (!r) return;
    if (r.kind === "pay" && !(await Lock.confirm(me, `Pay ${NPay.money(r.amount)}`, `to ${r.label}`))) return;
    const btn = $("cOk");
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Processing…';
    try {
      await Backend.settleRequest(r.id);
    } catch (err) {
      closeSheet();
      return fail(err.message, NPay.money(r.amount));
    }
    closeSheet();
    if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
    afterMoney = true;
    showResult({
      ok: true,
      title: r.kind === "pay" ? `Paid to ${r.label}` : `Received from ${r.label}`,
      amount: NPay.money(r.amount),
      text: r.note || "",
      rows: [["New balance", NPay.money(me.balance)], ["Time", new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })], ["Reference", r.id.replace(/-/g, "").slice(0, 12).toUpperCase()]],
    });
  }

  // ---------- Sending to a person (their account QR) ----------
  let sendTo = null;

  function startSend(req) {
    if (req.uid === me.id) return fail("That's your own code", "", "Scan someone else's code to send them money.");
    sendTo = req;
    $("sFriend").hidden = true;
    NPay.paintAvatar($("sAvatar"), { name: req.n, color: req.c });
    $("sWho").textContent = req.n;
    $("sUser").textContent = "@" + req.u;
    const fixed = !!req.amt;
    $("sAmount").value = fixed ? (req.amt / 100).toFixed(2) : "";
    $("sAmount").readOnly = fixed;
    $("sAmountWrap").classList.toggle("locked", fixed);
    $("sNote").value = req.note || "";
    $("sBal").textContent = `You have ${NPay.money(me.balance)}`;
    updateSendBtn();
    openSheet("sendSheet");
    // Show their current name and photo (the QR may be older than their profile).
    Backend.getProfile(req.uid).then((p) => {
      if (sendTo !== req) return;
      if (!p) { closeSheet(); return fail("Account not found", "", "This person's account no longer exists."); }
      sendTo = { ...req, n: p.name, u: p.username, c: p.color };
      friendChip($("sFriend"), p.id);
      NPay.paintAvatar($("sAvatar"), p);
      $("sWho").textContent = p.name;
      $("sUser").textContent = "@" + p.username;
    }).catch(() => {});
  }

  function updateSendBtn() {
    const amt = NPay.parseAmount($("sAmount").value);
    $("sOk").textContent = amt ? `Send ${NPay.money(amt)}` : "Send";
    $("sAmountWrap").classList.toggle("over", !!amt && amt > me.balance);
  }
  $("sAmount").addEventListener("input", updateSendBtn);

  async function doSend() {
    const amt = NPay.parseAmount($("sAmount").value);
    if (!amt) { shake($("sAmountWrap")); NPay.toast("Enter an amount, like 4.50"); return; }
    if (amt > me.balance) { shake($("sAmountWrap")); NPay.toast("Not enough money"); return; }
    const to = sendTo;
    const note = $("sNote").value.trim();
    if (!(await Lock.confirm(me, `Send ${NPay.money(amt)}`, `to ${to.n}`))) return;
    const btn = $("sOk");
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Sending…';
    try {
      await Backend.sendMoney(to.uid, amt, note);
    } catch (err) {
      btn.disabled = false;
      updateSendBtn();
      NPay.toast(err.message);
      return;
    }
    btn.disabled = false;
    closeSheet();
    if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
    afterMoney = true;
    showResult({
      ok: true,
      title: `Sent to ${to.n}`,
      amount: NPay.money(amt),
      text: note ? `${note} · it's in their wallet now` : "It's in their wallet now",
      rows: [["New balance", NPay.money(me.balance)], ["To", "@" + to.u]],
    });
  }

  // ================= Result screen =================
  let afterMoney = false;

  function showResult({ ok, title, amount = "", text = "", rows = [] }) {
    $("rCheck").className = ok ? "check" : "check bad";
    $("rMark").setAttribute("d", ok ? "M34 53l12 12 24-26" : "M38 38l28 28M66 38L38 66");
    $("rTitle").textContent = title;
    $("rAmount").textContent = amount;
    $("rAmount").style.display = amount ? "" : "none";
    $("rText").textContent = text;
    $("rText").style.display = text ? "" : "none";
    $("rReceipt").innerHTML = rows.map(([k, v]) => `<div class="row"><span>${k}</span><span class="num">${NPay.escapeHtml(v)}</span></div>`).join("");
    $("rReceipt").style.display = rows.length ? "" : "none";
    openScreen("resultScreen");
  }

  $("rDone").onclick = () => {
    closeScreen("resultScreen");
    if (afterMoney) {
      afterMoney = false;
      setTimeout(async () => {
        renderBalance(true);
        const before = new Set(history.map((t) => t.id));
        await reloadHistory();
        const fresh = history.find((t) => !before.has(t.id));
        if (fresh) renderHistory(fresh.id);
      }, 250);
    }
  };

  async function copyText(text, msg) {
    try { await navigator.clipboard.writeText(text); NPay.toast(msg || "Copied"); } catch { NPay.toast("Couldn't copy"); }
  }

  // ================= Transaction details =================
  function openTx(tx) {
    const incoming = tx.amount > 0;
    NPay.paintAvatar($("tAvatar"), txAvatar(tx));
    $("tKind").textContent = KIND_TITLE[tx.kind] || (incoming ? "You received from" : "You paid");
    $("tWho").textContent = tx.other_name + (tx.other_username ? ` · @${tx.other_username}` : "");
    $("tAmount").textContent = NPay.money(tx.amount, true);
    $("tAmount").classList.toggle("in", incoming);
    $("tNote").textContent = tx.note || "";
    $("tNote").style.display = tx.note ? "" : "none";
    const rows = [["Date", new Date(tx.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })], ["Reference", tx.ref]];
    $("tRows").innerHTML = rows.map(([k, v]) => `<div class="row"><span>${k}</span><span class="num">${NPay.escapeHtml(v)}</span></div>`).join("");
    $("tFriend").hidden = true;
    if (tx.other_id && tx.other_id !== me.id) friendChip($("tFriend"), tx.other_id, true);
    openSheet("txSheet");
  }
  $("tClose").onclick = closeSheet;

  // ================= My code =================
  let codeReq = { amt: undefined, note: undefined };

  function codeLink() {
    return NPay.linkFor({ t: "user", uid: me.id, u: me.username, n: me.name, c: me.color, amt: codeReq.amt, note: codeReq.note });
  }

  function renderCode() {
    NPay.paintAvatar($("codeAvatar"), me);
    $("codeName").textContent = me.name;
    $("codeUser").textContent = "@" + me.username;
    $("codeAmount").hidden = !codeReq.amt;
    $("codeAmount").textContent = codeReq.amt ? NPay.money(codeReq.amt) + (codeReq.note ? ` · ${codeReq.note}` : "") : "";
    $("codeCaption").textContent = codeReq.amt ? `Scan with NPay to pay me ${NPay.money(codeReq.amt)}` : "Scan with NPay to send me money";
    $("codeAmountBtn").textContent = codeReq.amt ? "Change amount" : "Request an amount";
    NPay.drawQr($("codeQr"), codeLink(), 512);
    // The middle of the code shows your photo, or the NPay mark.
    const logo = $("codeLogo");
    logo.className = me.avatar ? "photo" : "";
    logo.innerHTML = me.avatar ? `<img src="${me.avatar}" alt="">` : LOGO;
    const frame = $("codeQrFrame");
    frame.classList.remove("pop");
    void frame.offsetWidth;
    frame.classList.add("pop");
  }

  function openCode() {
    renderCode();
    openScreen("codeScreen");
  }

  $("codeBtn").onclick = openCode;
  $("codeClose").onclick = () => closeScreen("codeScreen");
  $("codeScan").onclick = () => { closeScreen("codeScreen"); startScan(); };
  $("scanToCode").onclick = () => { stopScan(); openCode(); };

  $("codeAmountBtn").onclick = () => {
    $("aAmount").value = codeReq.amt ? (codeReq.amt / 100).toFixed(2) : "";
    $("aNote").value = codeReq.note || "";
    openSheet("amountSheet");
  };
  document.querySelectorAll("#aQuick [data-q]").forEach((b) => (b.onclick = () => { $("aAmount").value = b.dataset.q; $("aAmount").focus(); }));
  $("aOk").onclick = () => {
    const amt = NPay.parseAmount($("aAmount").value);
    if (!amt) { shake($("aAmountWrap")); NPay.toast("Enter an amount, like 4.50"); return; }
    codeReq = { amt, note: $("aNote").value.trim() || undefined };
    closeSheet();
    renderCode();
  };
  $("aClear").onclick = () => { codeReq = { amt: undefined, note: undefined }; closeSheet(); renderCode(); };

  $("codeShareBtn").onclick = async () => {
    const link = codeLink();
    if (navigator.share) {
      try { await navigator.share({ title: `Pay ${me.name} with NPay`, url: link }); return; } catch (e) { if (e.name === "AbortError") return; }
    }
    copyText(link, "Link copied");
  };

  // Compose a shareable card image: name, username, amount and the QR.
  $("codeSaveBtn").onclick = async () => {
    const qr = $("codeQr").querySelector("canvas");
    if (!qr) return;
    const W = 1080, H = 1440;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d");
    const font = (w, s) => `${w} ${s}px Geist, Inter, system-ui, sans-serif`;
    g.fillStyle = "#32292f"; g.fillRect(0, 0, W, H);
    const glow = (x, y, r, a) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(153,225,217,${a})`); gr.addColorStop(1, "rgba(153,225,217,0)"); g.fillStyle = gr; g.fillRect(0, 0, W, H); };
    glow(160, 120, 620, 0.5); glow(W - 80, H * 0.6, 560, 0.25);
    g.fillStyle = "#ffffff";
    roundRect(g, 90, 150, W - 180, H - 300, 56); g.fill();
    const ax = W / 2, ay = 150, ar = 96;
    g.save(); g.beginPath(); g.arc(ax, ay, ar + 12, 0, Math.PI * 2); g.fillStyle = "#ffffff"; g.fill(); g.restore();
    await drawAvatar(g, ax, ay, ar, me);
    g.textAlign = "center";
    g.fillStyle = "#32292f"; g.font = font(700, 60); g.fillText(me.name, W / 2, 340, W - 260);
    g.fillStyle = "#6c5f68"; g.font = font(500, 38); g.fillText("@" + me.username, W / 2, 396);
    let qy = 450;
    if (codeReq.amt) { g.fillStyle = "#32292f"; g.font = font(800, 72); g.fillText(NPay.money(codeReq.amt), W / 2, 500); qy = 540; }
    const qs = 640;
    g.imageSmoothingEnabled = false;
    g.drawImage(qr, (W - qs) / 2, qy, qs, qs);
    const cx = W / 2, cy = qy + qs / 2;
    g.fillStyle = "#ffffff"; roundRect(g, cx - 66, cy - 66, 132, 132, 34); g.fill();
    if (me.avatar) await drawAvatar(g, cx, cy, 54, me);
    else { g.fillStyle = "#32292f"; roundRect(g, cx - 54, cy - 54, 108, 108, 28); g.fill(); g.fillStyle = "#99e1d9"; g.font = font(800, 64); g.textBaseline = "middle"; g.fillText("N", cx, cy + 3); g.textBaseline = "alphabetic"; }
    g.fillStyle = "#6c5f68"; g.font = font(500, 36);
    g.fillText(codeReq.amt ? `Scan with NPay to pay me ${NPay.money(codeReq.amt)}` : "Scan with NPay to send me money", W / 2, qy + qs + 70, W - 260);
    g.fillStyle = "#99e1d9"; g.font = font(800, 44); g.fillText("NPay", W / 2, H - 70);

    c.toBlob((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `npay-${me.username}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      NPay.toast("Image saved");
    }, "image/png");
  };

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  async function drawAvatar(g, x, y, r, acc) {
    g.save();
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.closePath(); g.clip();
    if (acc.avatar) {
      const img = new Image();
      img.src = acc.avatar;
      await img.decode().catch(() => {});
      g.drawImage(img, x - r, y - r, r * 2, r * 2);
    } else {
      g.fillStyle = acc.color || NPay.colorFor(acc.name);
      g.fillRect(x - r, y - r, r * 2, r * 2);
      g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle";
      g.font = `700 ${Math.round(r * 0.8)}px Geist, Inter, system-ui, sans-serif`;
      g.fillText(NPay.initials(acc.name), x, y + 2);
      g.textBaseline = "alphabetic";
    }
    g.restore();
  }

  // ================= Profile =================
  function renderProfile() {
    NPay.paintAvatar($("pAvatar"), me);
    $("pNameView").textContent = me.name;
    $("pUserView").textContent = "@" + me.username;
    $("pUser").textContent = "@" + me.username;
    $("pEmail").textContent = me.email || "";
    $("pSince").textContent = new Date(me.created_at).toLocaleDateString(undefined, { month: "long", year: "numeric" });
    $("pCount").textContent = history.length >= 100 ? "100+" : history.length;
    const theme = NPay.store.get("npay.theme", "system");
    const idx = ["system", "light", "dark"].indexOf(theme);
    $("themeSeg").dataset.mode = "abc"[idx];
    $("themeSeg").querySelectorAll("button").forEach((b, i) => { b.classList.toggle("on", i === idx); b.setAttribute("aria-checked", i === idx); });
    Lock.bio.available().then((ok) => {
      $("pBioRow").hidden = !ok;
      $("pBioLabel").textContent = "Unlock with " + (Lock.bio.name === "Face ID" ? "Face ID" : "fingerprint / face");
      $("pBio").checked = Lock.bio.enabled(me.id);
    });
  }

  function openProfile() {
    $("pName").value = me.name;
    renderProfile();
    openScreen("profileScreen");
  }

  async function saveProfile(fields, okMsg) {
    try {
      await Backend.updateProfile(fields);
      renderProfile();
      renderHeader();
      NPay.toast(okMsg);
    } catch (err) {
      NPay.toast(err.message);
    }
  }

  $("profileBtn").onclick = openProfile;
  $("profileClose").onclick = () => closeScreen("profileScreen");
  $("pShowCode").onclick = () => { closeScreen("profileScreen"); openCode(); };

  async function editPicture() {
    const res = await AvatarEditor.open(me);
    if (!res) return;
    await saveProfile({ avatar: res.avatar, color: res.color || me.color }, res.avatar ? "Picture updated" : "Picture removed");
  }
  $("pEditPic").onclick = editPicture;
  $("pEditPic2").onclick = editPicture;

  $("pSave").onclick = () => {
    const name = $("pName").value.trim();
    if (!name) { NPay.toast("Your name can't be empty"); $("pName").focus(); return; }
    busy($("pSave"), "Saving…", () => saveProfile({ name }, "Saved"));
  };

  $("themeSeg").querySelectorAll("button").forEach((b) => {
    b.onclick = () => { NPay.store.set("npay.theme", b.dataset.themeOpt); NPay.applyTheme(); renderProfile(); };
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => NPay.applyTheme());

  // ---------- PIN & Face ID
  async function forgotPin() {
    const email = me?.email || "";
    sessionStorage.setItem("npay.resetPin", "1");
    await Backend.signOut();
    showAuth();
    setAuthTab("in");
    $("liEmail").value = email;
    authNote("Sign in with your password, then choose a new PIN.");
  }

  // After choosing a PIN, offer Face ID / fingerprint once.
  async function offerBio() {
    if (Lock.bio.enabled(me.id) || !(await Lock.bio.available())) return;
    const label = Lock.bio.name === "Face ID" ? "Face ID" : "your fingerprint or face";
    $("bioTitle").textContent = `Unlock with ${Lock.bio.name === "Face ID" ? "Face ID" : "fingerprint"}?`;
    $("bioText").textContent = `Open NPay and confirm payments with ${label} instead of typing your PIN. Your PIN still works too.`;
    openSheet("bioSheet");
    await new Promise((resolve) => {
      $("bioNo").onclick = () => { closeSheet(); resolve(); };
      $("bioYes").onclick = async () => {
        closeSheet();
        try { await Lock.bio.enable(me); NPay.toast("Turned on"); } catch { NPay.toast("Couldn't turn it on — you can try again in your profile"); }
        resolve();
      };
    });
  }

  $("pPin").onclick = async () => { if (await Lock.change(me)) NPay.toast("PIN changed"); };
  $("pBio").onchange = async (e) => {
    if (e.target.checked) {
      try { await Lock.bio.enable(me); NPay.toast("Turned on"); }
      catch { e.target.checked = false; NPay.toast("Couldn't turn it on"); }
    } else {
      Lock.bio.disable(me.id);
      NPay.toast("Turned off");
    }
  };
  $("pLock").onclick = () => { closeScreen("profileScreen"); Lock.unlock(me, { onForgot: forgotPin }); };

  $("pLogout").onclick = async () => {
    await Backend.signOut();
    closeScreen("profileScreen");
    showAuth();
    setAuthTab("in");
    NPay.toast("Signed out");
  };

  $("pPassword").onclick = () => { $("pwOld").value = $("pwNew").value = ""; $("pwErr").textContent = ""; openSheet("pwSheet"); };
  $("pwCancel").onclick = closeSheet;
  $("pwOk").onclick = () => busy($("pwOk"), "", async () => {
    if ($("pwNew").value.length < 6) { $("pwErr").textContent = "New password needs at least 6 characters"; return; }
    try { await Backend.changePassword($("pwOld").value, $("pwNew").value); closeSheet(); NPay.toast("Password changed"); }
    catch (err) { $("pwErr").textContent = err.message; }
  });

  $("pDelete").onclick = () => { $("delPw").value = ""; $("delErr").textContent = ""; openSheet("delSheet"); };
  $("delCancel").onclick = closeSheet;
  $("delOk").onclick = () => busy($("delOk"), "", async () => {
    try {
      await Backend.deleteAccount($("delPw").value);
      closeSheet();
      closeScreen("profileScreen");
      showAuth();
      NPay.toast("Account deleted");
    } catch (err) { $("delErr").textContent = err.message; }
  });

  // ================= Friends =================
  const relationOf = (uid) => friendsList.find((f) => f.user_id === uid) || null;

  async function refreshFriends(fromLive) {
    if (!me) return;
    try { friendsList = await Backend.friends(); } catch { return; }
    const incoming = friendsList.filter((f) => f.status === "incoming").length;
    const unread = friendsList.reduce((n, f) => n + (f.status === "friends" ? f.unread : 0), 0);
    const total = incoming + unread;
    $("friendsBadge").hidden = !total;
    $("friendsBadge").textContent = total > 9 ? "9+" : total;
    $("friendsBtn").setAttribute("aria-label", total ? `Friends and chats, ${total} new` : "Friends and chats");
    if (isOpen("friendsScreen")) { renderFriends(); if ($("frSearch").value.trim().length >= 2) runSearch(); }
    if (fromLive && incoming && !isOpen("friendsScreen")) {
      const newest = friendsList.find((f) => f.status === "incoming");
      if (newest && !seenRequests.has(newest.friendship_id)) NPay.toast(`${newest.name} wants to be friends`);
    }
    friendsList.filter((f) => f.status === "incoming").forEach((f) => seenRequests.add(f.friendship_id));
  }
  const seenRequests = new Set();

  // A button that adds / accepts / shows the friendship with someone.
  function friendChip(btn, uid, block) {
    const label = () => {
      const f = relationOf(uid);
      if (!f) return ["Add friend", false];
      if (f.status === "incoming") return ["Accept friend request", false];
      if (f.status === "outgoing") return ["Friend request sent", true];
      return ["Message", false];
    };
    const paint = () => { const [t, dis] = label(); btn.textContent = t; btn.disabled = dis; btn.hidden = false; };
    paint();
    btn.onclick = async () => {
      const f = relationOf(uid);
      if (f?.status === "friends") { closeSheet(); openChat(f); return; }
      btn.disabled = true;
      try {
        const res = await Backend.addFriend(uid);
        await refreshFriends();
        NPay.toast(res === "accepted" ? "You're now friends" : "Friend request sent");
      } catch (err) { NPay.toast(err.message); }
      paint();
    };
    if (block) btn.classList.toggle("primary", !relationOf(uid));
  }

  function timeAgo(ts) {
    const d = new Date(ts), now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    const days = Math.round((now - d) / 864e5);
    if (days < 7) return d.toLocaleDateString(undefined, { weekday: "short" });
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  }

  function personRow(p, action) {
    const row = document.createElement("div");
    row.className = "li person";
    row.innerHTML = `<span class="avatar sm"></span><span class="person-text"><b>${NPay.escapeHtml(p.name)}</b><small>@${NPay.escapeHtml(p.username)}</small></span><span class="person-actions"></span>`;
    NPay.paintAvatar(row.querySelector(".avatar"), p);
    action(row.querySelector(".person-actions"));
    return row;
  }
  function smallBtn(label, cls, onclick) {
    const b = document.createElement("button");
    b.className = "btn small " + (cls || "");
    b.textContent = label;
    b.onclick = async () => { b.disabled = true; try { await onclick(); } catch (err) { NPay.toast(err.message); } b.disabled = false; };
    return b;
  }

  function renderFriends() {
    const reqs = friendsList.filter((f) => f.status !== "friends");
    $("frRequestsWrap").hidden = !reqs.length;
    $("frRequests").innerHTML = "";
    reqs.forEach((f) => {
      $("frRequests").appendChild(personRow(f, (box) => {
        if (f.status === "incoming") {
          box.append(
            smallBtn("Decline", "ghost", async () => { await Backend.respondFriend(f.friendship_id, false); await refreshFriends(); }),
            smallBtn("Accept", "primary", async () => { await Backend.respondFriend(f.friendship_id, true); await refreshFriends(); NPay.toast(`You and ${f.name} are friends now`); }));
        } else {
          box.append(smallBtn("Cancel", "ghost", async () => { await Backend.removeFriend(f.user_id); await refreshFriends(); NPay.toast("Request cancelled"); }));
        }
      }));
    });

    const friends = friendsList.filter((f) => f.status === "friends");
    $("frList").innerHTML = "";
    if (!friends.length) {
      $("frList").innerHTML = '<div class="empty"><b>No friends yet.</b><br>Search for a username above, or tap <i>Add friend</i> after scanning someone\'s code.</div>';
      return;
    }
    friends.forEach((f) => {
      const row = document.createElement("button");
      row.className = "li chat-row" + (f.unread ? " unread" : "");
      const preview = f.last_body ? (f.last_from_me ? "You: " : "") + f.last_body : "Say hi 👋";
      row.innerHTML = `<span class="avatar"></span>
        <span class="person-text"><b>${NPay.escapeHtml(f.name)}</b><small>${NPay.escapeHtml(preview)}</small></span>
        <span class="chat-meta"><small>${f.last_body ? timeAgo(f.last_at) : ""}</small>${f.unread ? `<span class="badge">${f.unread > 9 ? "9+" : f.unread}</span>` : ""}</span>`;
      NPay.paintAvatar(row.querySelector(".avatar"), f);
      row.onclick = () => openChat(f);
      $("frList").appendChild(row);
    });
  }

  let searchTimer = null, searchSeq = 0;
  async function runSearch() {
    const q = $("frSearch").value.trim().replace(/^@/, "").toLowerCase();
    if (q.length < 2) { $("frResultsWrap").hidden = true; return; }
    const seq = ++searchSeq;
    let rows;
    try { rows = await Backend.searchUsers(q); } catch (err) { NPay.toast(err.message); return; }
    if (seq !== searchSeq) return;
    $("frResultsWrap").hidden = false;
    $("frResults").innerHTML = "";
    if (!rows.length) { $("frResults").innerHTML = `<div class="empty">Nobody called @${NPay.escapeHtml(q)}…</div>`; return; }
    rows.forEach((p) => {
      $("frResults").appendChild(personRow(p, (box) => {
        const f = relationOf(p.id);
        if (f?.status === "friends") box.append(smallBtn("Message", "", async () => openChat(f)));
        else if (f?.status === "outgoing") box.append(smallBtn("Requested", "ghost", async () => {}));
        else box.append(smallBtn(f?.status === "incoming" ? "Accept" : "Add", "primary", async () => {
          const res = await Backend.addFriend(p.id);
          await refreshFriends();
          NPay.toast(res === "accepted" ? `You and ${p.name} are friends now` : "Friend request sent");
        }));
      }));
    });
  }
  $("frSearch").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 250); });

  $("friendsBtn").onclick = () => { renderFriends(); openScreen("friendsScreen"); refreshFriends(); };
  $("frClose").onclick = () => closeScreen("friendsScreen");

  // ================= Chat =================
  let chatItems = [];

  const paymentItem = (t) => ({ type: "pay", id: "t" + t.id, at: t.created_at, mine: t.amount < 0, amount: Math.abs(t.amount), note: t.note });
  const messageItem = (m) => ({ type: "msg", id: "m" + m.id, at: m.created_at, mine: m.sender_id === me.id, body: m.body });

  async function openChat(f) {
    chatWith = f;
    NPay.paintAvatar($("chAvatar"), f);
    $("chName").textContent = f.name;
    $("chUser").textContent = "@" + f.username;
    $("chLog").innerHTML = '<div class="empty">Loading…</div>';
    $("chInput").value = "";
    openScreen("chatScreen");
    try {
      const [msgs, pays] = await Promise.all([Backend.messages(f.user_id), Backend.paymentsWith(f.user_id)]);
      if (chatWith !== f) return;
      chatItems = [...msgs.map(messageItem), ...pays.map(paymentItem)].sort((a, b) => new Date(a.at) - new Date(b.at));
      renderChat();
    } catch (err) {
      $("chLog").innerHTML = `<div class="empty">${NPay.escapeHtml(err.message)}</div>`;
    }
    if (f.unread) { await Backend.markRead(f.user_id); refreshFriends(); }
    if (matchMedia("(pointer: fine)").matches) $("chInput").focus();
  }

  function closeChat() {
    chatWith = null;
    closeScreen("chatScreen");
    refreshFriends();
  }

  function itemHtml(it) {
    if (it.type === "pay") {
      const who = it.mine ? `You sent ${chatWith.name.split(" ")[0]}` : `${chatWith.name.split(" ")[0]} sent you`;
      return `<div class="pay-bubble ${it.mine ? "" : "in"}"><span>${NPay.escapeHtml(who)}</span><b class="num">${NPay.money(it.amount)}</b>${it.note ? `<small>${NPay.escapeHtml(it.note)}</small>` : ""}</div>`;
    }
    const time = new Date(it.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    return `<div class="msg ${it.mine ? "me" : "them"}${it.failed ? " failed" : ""}"><p>${NPay.escapeHtml(it.body)}</p><time>${it.failed ? "Not sent" : time}</time></div>`;
  }

  function renderChat() {
    if (!chatItems.length) {
      $("chLog").innerHTML = `<div class="empty chat-empty"><span class="avatar xl"></span><b>${NPay.escapeHtml(chatWith.name)}</b><br>You're friends. Say hi, or send some money.</div>`;
      NPay.paintAvatar($("chLog").querySelector(".avatar"), chatWith);
      return;
    }
    let lastDay = "";
    $("chLog").innerHTML = chatItems.map((it) => {
      const day = dayLabel(it.at);
      const sep = day !== lastDay ? `<div class="chat-day">${day}</div>` : "";
      lastDay = day;
      return sep + itemHtml(it);
    }).join("");
    $("chLog").scrollTop = $("chLog").scrollHeight;
  }

  function appendChatItem(it) {
    if (chatItems.some((x) => x.id === it.id)) return;
    chatItems.push(it);
    renderChat();
  }

  function onIncomingMessage(m) {
    if (chatWith && m.sender_id === chatWith.user_id && isOpen("chatScreen")) {
      appendChatItem(messageItem(m));
      Backend.markRead(chatWith.user_id);
      return;
    }
    const f = relationOf(m.sender_id);
    NPay.toast(`${f ? f.name.split(" ")[0] : "New message"}: ${m.body.slice(0, 60)}`);
    if (navigator.vibrate) navigator.vibrate(20);
    refreshFriends();
  }

  $("chForm").onsubmit = async (e) => {
    e.preventDefault();
    const body = $("chInput").value.trim();
    if (!body || !chatWith) return;
    $("chInput").value = "";
    const temp = { type: "msg", id: "tmp" + Date.now(), at: new Date().toISOString(), mine: true, body };
    appendChatItem(temp);
    try {
      const m = await Backend.sendMessage(chatWith.user_id, body);
      Object.assign(temp, messageItem(m));
    } catch (err) {
      temp.failed = true;
      NPay.toast(err.message);
    }
    renderChat();
  };

  function payFriend() {
    const f = chatWith;
    closeSheet();
    startSend({ t: "user", uid: f.user_id, u: f.username, n: f.name, c: f.color });
  }
  $("chPay").onclick = payFriend;
  $("chClose").onclick = closeChat;
  $("chMenu").onclick = () => { $("csTitle").textContent = chatWith.name; openSheet("chatSheet"); };
  $("csPay").onclick = payFriend;
  $("csClose").onclick = closeSheet;
  $("csRemove").onclick = async () => {
    const f = chatWith;
    if (!confirm(`Remove ${f.name} from your friends? You won't be able to message each other.`)) return;
    try {
      await Backend.removeFriend(f.user_id);
      closeSheet();
      closeChat();
      NPay.toast(`${f.name} removed`);
    } catch (err) { NPay.toast(err.message); }
  };

  // ================= Camera scanner =================
  let stream = null;
  let scanning = false;
  let detector = null;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  async function startScan() {
    $("scanWindow").classList.remove("found");
    $("scanHint").textContent = "Point your camera at a QR code";
    openScreen("scanScreen");
    if (!navigator.mediaDevices?.getUserMedia) {
      $("scanHint").textContent = "This browser can't use the camera here. Use the https site, or scan with your phone's camera app.";
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    } catch {
      $("scanHint").textContent = "Camera blocked. Allow camera access for this site and try again.";
      return;
    }
    if (!isOpen("scanScreen")) { stopStream(); return; }
    const video = $("video");
    video.srcObject = stream;
    await video.play().catch(() => {});

    if (!detector && "BarcodeDetector" in window) {
      try {
        const formats = await BarcodeDetector.getSupportedFormats();
        if (formats.includes("qr_code")) detector = new BarcodeDetector({ formats: ["qr_code"] });
      } catch {}
    }
    scanning = true;
    requestAnimationFrame(tick);
  }

  function stopStream() {
    scanning = false;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    $("video").srcObject = null;
  }

  function stopScan() {
    stopStream();
    closeScreen("scanScreen");
  }

  async function tick() {
    if (!scanning) return;
    const video = $("video");
    if (video.readyState >= 2 && video.videoWidth) {
      let text = null;
      try {
        if (detector) {
          const codes = await detector.detect(video);
          if (codes.length) text = codes[0].rawValue;
        } else if (window.jsQR) {
          const w = 640;
          const h = Math.round((video.videoHeight / video.videoWidth) * w);
          canvas.width = w;
          canvas.height = h;
          ctx.drawImage(video, 0, 0, w, h);
          const img = ctx.getImageData(0, 0, w, h);
          const code = jsQR(img.data, w, h, { inversionAttempts: "dontInvert" });
          if (code) text = code.data;
        }
      } catch {}
      if (text) {
        scanning = false;
        if (navigator.vibrate) navigator.vibrate(20);
        $("scanWindow").classList.add("found");
        const req = NPay.parseScanned(text);
        setTimeout(() => { stopScan(); handleRequest(req); }, 280);
        return;
      }
    }
    setTimeout(() => requestAnimationFrame(tick), 100);
  }

  // ================= Opened via a link (scanned with the phone's own camera app) =================
  function checkHash() {
    if (!location.hash.includes("r=")) return;
    const hash = location.hash;
    history_replace();
    if (!me) {
      sessionStorage.setItem(PENDING, hash);
      NPay.toast("Sign in or create an account to continue");
      return;
    }
    setTimeout(() => handleRequest(NPay.parseScanned(hash)), 350);
  }
  function history_replace() {
    window.history.replaceState(null, "", location.pathname + location.search);
  }

  // ================= Wire up =================
  $("scanBtn").onclick = startScan;
  $("scanClose").onclick = stopScan;
  $("cCancel").onclick = closeSheet;
  $("cOk").onclick = confirmPending;
  $("sCancel").onclick = closeSheet;
  $("sOk").onclick = doSend;
  $("sAmount").addEventListener("keydown", (e) => { if (e.key === "Enter") doSend(); });
  $("aAmount").addEventListener("keydown", (e) => { if (e.key === "Enter") $("aOk").click(); });

  $("eyeBtn").onclick = () => { hide = !hide; NPay.store.set("npay.hide", hide); renderHeader(); };

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || Lock.isOpen()) return;
    if (openSheetId) closeSheet();
    else if (isOpen("scanScreen")) stopScan();
    else if (isOpen("codeScreen")) closeScreen("codeScreen");
    else if (isOpen("chatScreen")) closeChat();
    else if (isOpen("friendsScreen")) closeScreen("friendsScreen");
    else if (isOpen("profileScreen")) closeScreen("profileScreen");
  });

  // Catch up when the app comes back to the front (live updates pause in the background).
  let hiddenAt = 0;
  document.addEventListener("visibilitychange", async () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (!me) return;
    // Away for more than a minute: ask for the PIN again.
    if (hiddenAt && Date.now() - hiddenAt > 60_000 && !Lock.isOpen()) Lock.unlock(me, { onForgot: forgotPin });
    hiddenAt = 0;
    refreshFriends();
    renderHeader();
    try { await Backend.refreshBalance(); } catch {}
    if (me.balance !== shownBalance) renderBalance(true);
    reloadHistory();
  });

  // Signed out elsewhere (another tab, password change, deleted account).
  Backend.onAuthChange?.((event) => { if (event === "SIGNED_OUT" && me) showAuth(); });

  window.addEventListener("hashchange", checkHash);
  boot().then(checkHash);

  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
