// NPay wallet — runs on the phone. Balance and history live in this browser (localStorage).
(() => {
  const START_BALANCE = 100_00; // €100.00 for a fresh wallet
  const $ = (id) => document.getElementById(id);
  const ICON_OUT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7M9 7h8v8"/></svg>';
  const ICON_IN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M17 7L7 17M15 17H7V9"/></svg>';
  const EYE_OPEN = '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>';
  const EYE_SHUT = '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/>';

  // ---------- State ----------
  let wallet = NPay.store.get("npay.wallet.eur", null);
  if (!wallet) {
    wallet = { name: "Me", balance: START_BALANCE, history: [], used: [], hide: false };
    save();
  }
  let shownBalance = wallet.balance;

  function save() {
    wallet.used = wallet.used.slice(-500);
    wallet.history = wallet.history.slice(0, 200);
    NPay.store.set("npay.wallet.eur", wallet);
  }

  // ---------- Rendering ----------
  function greeting() {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  }

  function renderHeader() {
    $("greeting").textContent = greeting();
    $("ownerName").textContent = wallet.name;
    $("avatar").textContent = NPay.initials(wallet.name);
    $("balance").classList.toggle("hidden", !!wallet.hide);
    $("eyeIcon").innerHTML = wallet.hide ? EYE_SHUT : EYE_OPEN;
    $("eyeBtn").setAttribute("aria-label", wallet.hide ? "Show balance" : "Hide balance");
  }

  function renderBalance(animate) {
    const el = $("balance");
    if (animate) {
      NPay.animateMoney(el, shownBalance, wallet.balance, 900);
      el.classList.remove("bump");
      void el.offsetWidth;
      el.classList.add("bump");
    } else {
      el.textContent = NPay.money(wallet.balance);
    }
    shownBalance = wallet.balance;
  }

  function dayLabel(ts) {
    const d = new Date(ts);
    const today = new Date();
    const y = new Date(); y.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return "Today";
    if (d.toDateString() === y.toDateString()) return "Yesterday";
    return d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
  }

  function renderHistory(newId) {
    const h = $("history");
    $("txCount").textContent = wallet.history.length ? `${wallet.history.length} payment${wallet.history.length === 1 ? "" : "s"}` : "";
    if (!wallet.history.length) {
      h.innerHTML = `<div class="empty">
        <div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h3"/></svg></div>
        No payments yet.<br>Scan a QR code to get started.</div>`;
      return;
    }
    let lastDay = "";
    let i = 0;
    h.innerHTML = wallet.history
      .map((tx) => {
        const incoming = tx.delta > 0;
        const day = dayLabel(tx.at);
        const header = day !== lastDay ? `<div class="day">${day}</div>` : "";
        lastDay = day;
        const time = new Date(tx.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
        const delay = Math.min(i++, 10) * 0.03;
        return `${header}<div class="tx ${tx.id === newId ? "new" : ""}" style="animation-delay:${delay}s">
          <div class="tx-icon ${incoming ? "in" : ""}">${incoming ? ICON_IN : ICON_OUT}</div>
          <div class="tx-main">
            <div class="tx-who">${NPay.escapeHtml(tx.who)}</div>
            <div class="tx-meta">${incoming ? "Received" : "Paid"} · ${time}${tx.note ? " · " + NPay.escapeHtml(tx.note) : ""}</div>
          </div>
          <div class="tx-amt num ${incoming ? "in" : ""}">${NPay.money(tx.delta, true)}</div>
        </div>`;
      })
      .join("");
  }

  // ---------- Sheets & screens ----------
  let openSheetId = null;
  function openSheet(id) {
    openSheetId = id;
    $("backdrop").classList.add("open");
    $(id).classList.add("open");
  }
  function closeSheet() {
    if (!openSheetId) return;
    $(openSheetId).classList.remove("open");
    $("backdrop").classList.remove("open");
    openSheetId = null;
  }
  $("backdrop").onclick = () => { pending = null; closeSheet(); };

  function openScreen(id) { $(id).classList.add("open"); $(id).setAttribute("aria-hidden", "false"); }
  function closeScreen(id) { $(id).classList.remove("open"); $(id).setAttribute("aria-hidden", "true"); }

  // Swipe a sheet down to close it.
  document.querySelectorAll(".sheet").forEach((sheet) => {
    let startY = null, dy = 0;
    sheet.addEventListener("touchstart", (e) => { if (e.target.closest("input,button")) return; startY = e.touches[0].clientY; dy = 0; sheet.style.transition = "none"; }, { passive: true });
    sheet.addEventListener("touchmove", (e) => { if (startY === null) return; dy = Math.max(0, e.touches[0].clientY - startY); sheet.style.transform = `translateY(${dy}px)`; }, { passive: true });
    sheet.addEventListener("touchend", () => {
      if (startY === null) return;
      sheet.style.transition = ""; sheet.style.transform = "";
      if (dy > 90) { pending = null; closeSheet(); }
      startY = null;
    });
  });

  // ---------- Handling a scanned request ----------
  let pending = null;

  function handleRequest(req) {
    if (!req) return showResult(false, "Not an NPay code", "", "This QR code isn't an NPay payment.");
    if (wallet.used.includes(req.id)) return showResult(false, "Already used", NPay.money(req.amt), "This QR code was already scanned. Ask for a new one.");
    if (req.exp && Date.now() > req.exp) return showResult(false, "Code expired", NPay.money(req.amt), "This code is no longer valid. Ask for a new one.");

    pending = req;
    const paying = req.t === "pay";
    const after = wallet.balance + (paying ? -req.amt : req.amt);
    const tooPoor = paying && after < 0;

    $("cAvatar").textContent = NPay.initials(req.who);
    $("cKind").textContent = paying ? "You're paying" : "You're receiving from";
    $("cWho").textContent = req.who;
    $("cAmount").textContent = NPay.money(req.amt);
    $("cNote").textContent = req.note || "";
    $("cNote").style.display = req.note ? "" : "none";
    $("cNow").textContent = NPay.money(wallet.balance);
    $("cAfter").innerHTML = tooPoor ? '<span class="warn">Not enough money</span>' : NPay.money(after);
    $("cOk").textContent = paying ? `Pay ${NPay.money(req.amt)}` : `Receive ${NPay.money(req.amt)}`;
    $("cOk").disabled = tooPoor;

    openSheet("confirmSheet");
  }

  function confirmPending() {
    const req = pending;
    if (!req) return;
    pending = null;
    const btn = $("cOk");
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Processing…';

    setTimeout(() => {
      closeSheet();
      if (wallet.used.includes(req.id)) return showResult(false, "Already used", NPay.money(req.amt), "");
      const delta = req.t === "pay" ? -req.amt : req.amt;
      if (wallet.balance + delta < 0) return showResult(false, "Not enough money", NPay.money(req.amt), "");

      wallet.balance += delta;
      wallet.used.push(req.id);
      wallet.history.unshift({ id: req.id, who: req.who, note: req.note || "", delta, at: Date.now() });
      save();
      lastTxId = req.id;

      if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
      const time = new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
      showResult(true, req.t === "pay" ? `Paid to ${req.who}` : `Received from ${req.who}`, NPay.money(req.amt), req.note || "", [
        ["New balance", NPay.money(wallet.balance)],
        ["Time", time],
        ["Reference", req.id.toUpperCase()],
      ]);
    }, 750);
  }

  let lastTxId = null;

  function showResult(ok, title, amount, text, rows = []) {
    $("rCheck").className = ok ? "check" : "check bad";
    $("rMark").setAttribute("d", ok ? "M34 53l12 12 24-26" : "M38 38l28 28M66 38L38 66");
    $("rTitle").textContent = title;
    $("rAmount").textContent = amount;
    $("rAmount").style.display = amount ? "" : "none";
    $("rText").textContent = text;
    $("rReceipt").innerHTML = rows.map(([k, v]) => `<div class="row"><span>${k}</span><span class="num">${NPay.escapeHtml(v)}</span></div>`).join("");
    $("rReceipt").style.display = rows.length ? "" : "none";
    openScreen("resultScreen");
  }

  $("rDone").onclick = () => {
    closeScreen("resultScreen");
    if (lastTxId) {
      // Let the screen fade, then roll the balance and slide in the new activity row.
      setTimeout(() => { renderBalance(true); renderHistory(lastTxId); lastTxId = null; }, 250);
    }
  };

  // ---------- Camera scanner ----------
  let stream = null;
  let scanning = false;
  let detector = null;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  async function startScan() {
    $("scanWindow").classList.remove("found");
    $("scanHint").textContent = "Point your camera at the QR code";
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
    if (!$("scanScreen").classList.contains("open")) { stopStream(); return; }
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

  // ---------- Opened via a link (scanned with the phone's own camera app) ----------
  function checkHash() {
    if (!location.hash.includes("r=")) return;
    const req = NPay.parseScanned(location.hash);
    history.replaceState(null, "", location.pathname + location.search);
    setTimeout(() => handleRequest(req), 350);
  }

  // ---------- Wire up ----------
  $("scanBtn").onclick = startScan;
  $("scanClose").onclick = stopScan;
  $("cCancel").onclick = () => { pending = null; closeSheet(); };
  $("cOk").onclick = confirmPending;

  $("eyeBtn").onclick = () => { wallet.hide = !wallet.hide; save(); renderHeader(); };

  $("settingsBtn").onclick = () => { $("sName").value = wallet.name; openSheet("settingsSheet"); };
  $("sSave").onclick = () => {
    wallet.name = $("sName").value.trim() || "Me";
    save();
    renderHeader();
    closeSheet();
    NPay.toast("Saved");
  };
  $("sReset").onclick = () => {
    if (!confirm(`Reset your wallet? Your balance goes back to ${NPay.money(START_BALANCE)} and your activity is cleared.`)) return;
    wallet = { name: wallet.name, balance: START_BALANCE, history: [], used: [], hide: wallet.hide };
    save();
    closeSheet();
    renderBalance(true);
    renderHistory();
    NPay.toast("Wallet reset");
  };

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if ($("scanScreen").classList.contains("open")) stopScan();
    else if (openSheetId) { pending = null; closeSheet(); }
  });

  window.addEventListener("hashchange", checkHash);
  renderHeader();
  renderBalance(false);
  renderHistory();
  checkHash();
})();
