// NPay wallet — runs on the phone. Balance and history live in this browser (localStorage).
(() => {
  const START_BALANCE = 100_00; // 100.00 NP for a fresh wallet
  const $ = (id) => document.getElementById(id);

  // ---------- State ----------
  let wallet = NPay.store.get("npay.wallet", null);
  if (!wallet) {
    wallet = { name: "Me", balance: START_BALANCE, history: [], used: [] };
    save();
  }

  function save() {
    // Keep the "used QR" list from growing forever.
    wallet.used = wallet.used.slice(-500);
    wallet.history = wallet.history.slice(0, 200);
    NPay.store.set("npay.wallet", wallet);
  }

  // ---------- Rendering ----------
  function render() {
    $("balance").textContent = NPay.money(wallet.balance);
    $("owner").textContent = wallet.name;

    const h = $("history");
    if (!wallet.history.length) {
      h.innerHTML = '<div class="empty">No payments yet. Scan a QR code to start.</div>';
      return;
    }
    h.innerHTML = wallet.history
      .map((tx) => {
        const incoming = tx.delta > 0;
        const when = new Date(tx.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
        return `<div class="tx">
          <div>
            <div class="who">${NPay.escapeHtml(tx.who)}</div>
            <div class="meta">${incoming ? "Received" : "Paid"} · ${when}${tx.note ? " · " + NPay.escapeHtml(tx.note) : ""}</div>
          </div>
          <div class="amt ${incoming ? "in" : ""}">${incoming ? "+" : ""}${NPay.money(tx.delta)}</div>
        </div>`;
      })
      .join("");
  }

  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove("show"), 2600);
  }

  function open(id) { $(id).classList.add("open"); }
  function close(id) { $(id).classList.remove("open"); }

  // ---------- Handling a scanned request ----------
  let pending = null;

  function handleRequest(req) {
    if (!req) return showResult(false, "Not an NPay code", "", "This QR code isn't an NPay payment.");
    if (wallet.used.includes(req.id)) return showResult(false, "Already used", NPay.money(req.amt), "This QR code was already scanned. Ask for a new one.");
    if (req.exp && Date.now() > req.exp) return showResult(false, "Code expired", NPay.money(req.amt), "Ask for a new QR code.");

    pending = req;
    const paying = req.t === "pay";
    const after = wallet.balance + (paying ? -req.amt : req.amt);

    $("cBadge").textContent = paying ? "↗" : "↙";
    $("cBadge").className = "badge";
    $("cKind").textContent = paying ? "Pay to" : "Receive from";
    $("cAmount").textContent = NPay.money(req.amt);
    $("cWho").textContent = req.who;
    $("cNote").textContent = req.note || "";
    $("cAfter").textContent = `Balance after: ${NPay.money(after)}`;
    $("cOk").textContent = paying ? "Pay" : "Receive";

    const tooPoor = paying && after < 0;
    $("cOk").disabled = tooPoor;
    if (tooPoor) $("cAfter").textContent = `Not enough money — you have ${NPay.money(wallet.balance)}`;

    open("confirmOverlay");
  }

  function confirmPending() {
    const req = pending;
    pending = null;
    close("confirmOverlay");
    if (!req) return;

    // Re-check in case of double taps.
    if (wallet.used.includes(req.id)) return showResult(false, "Already used", NPay.money(req.amt), "");
    const delta = req.t === "pay" ? -req.amt : req.amt;
    if (wallet.balance + delta < 0) return showResult(false, "Not enough money", NPay.money(req.amt), "");

    wallet.balance += delta;
    wallet.used.push(req.id);
    wallet.history.unshift({ id: req.id, who: req.who, note: req.note || "", delta, at: Date.now() });
    save();
    render();

    if (navigator.vibrate) navigator.vibrate(60);
    showResult(true, req.t === "pay" ? `Paid to ${req.who}` : `Received from ${req.who}`, NPay.money(req.amt), `New balance: ${NPay.money(wallet.balance)}`);
  }

  function showResult(ok, title, amount, text) {
    $("rBadge").textContent = ok ? "✓" : "✕";
    $("rBadge").className = ok ? "badge" : "badge bad";
    $("rTitle").textContent = title;
    $("rAmount").textContent = amount;
    $("rText").textContent = text;
    open("resultOverlay");
  }

  // ---------- Camera scanner ----------
  let stream = null;
  let scanning = false;
  let detector = null;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  async function startScan() {
    open("scanOverlay");
    $("scanHint").textContent = "Point the camera at the QR code on the screen.";
    if (!navigator.mediaDevices?.getUserMedia) {
      $("scanHint").textContent = "This browser can't use the camera. Open the page over https (GitHub Pages) or scan with your phone's camera app.";
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    } catch (e) {
      $("scanHint").textContent = "Camera blocked. Allow camera access for this site and try again.";
      return;
    }
    const video = $("video");
    video.srcObject = stream;
    await video.play().catch(() => {});

    if ("BarcodeDetector" in window) {
      try {
        const formats = await BarcodeDetector.getSupportedFormats();
        if (formats.includes("qr_code")) detector = new BarcodeDetector({ formats: ["qr_code"] });
      } catch {}
    }
    scanning = true;
    requestAnimationFrame(tick);
  }

  function stopScan() {
    scanning = false;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    $("video").srcObject = null;
    close("scanOverlay");
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
        stopScan();
        handleRequest(NPay.parseScanned(text));
        return;
      }
    }
    setTimeout(() => requestAnimationFrame(tick), 120);
  }

  // ---------- Opened via a link (scanned with the phone's own camera app) ----------
  function checkHash() {
    if (!location.hash.includes("r=")) return;
    const req = NPay.parseScanned(location.hash);
    history.replaceState(null, "", location.pathname + location.search);
    handleRequest(req);
  }

  // ---------- Wire up ----------
  $("scanBtn").onclick = startScan;
  $("scanClose").onclick = stopScan;
  $("cCancel").onclick = () => { pending = null; close("confirmOverlay"); };
  $("cOk").onclick = confirmPending;
  $("rDone").onclick = () => close("resultOverlay");

  $("settingsBtn").onclick = () => { $("sName").value = wallet.name; open("settingsOverlay"); };
  $("sClose").onclick = () => close("settingsOverlay");
  $("sSave").onclick = () => {
    wallet.name = $("sName").value.trim() || "Me";
    save();
    render();
    close("settingsOverlay");
    toast("Saved");
  };
  $("sReset").onclick = () => {
    if (!confirm("Reset your wallet? Your balance goes back to " + NPay.money(START_BALANCE) + " and activity is cleared.")) return;
    wallet = { name: wallet.name, balance: START_BALANCE, history: [], used: [] };
    save();
    render();
    close("settingsOverlay");
    toast("Wallet reset");
  };

  window.addEventListener("hashchange", checkHash);
  render();
  checkHash();
})();
