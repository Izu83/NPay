// NPay picture editor: a photo you can zoom and move, an emoji, or initials, on a
// background colour of your choice (optionally blended with a second colour).
//   AvatarEditor.open(user) -> Promise<{ avatar, color } | null>
const AvatarEditor = (() => {
  const $ = (id) => document.getElementById(id);
  const SIZE = 512;
  const SWATCHES = ["#32292f", "#99e1d9", "#2a9d8f", "#0f766e", "#2563eb", "#0ea5e9", "#475569", "#111827",
    "#ea580c", "#f59e0b", "#e11d48", "#db2777", "#16a34a", "#84cc16", "#b45309", "#f3ede4"];
  const EMOJI = ["😀", "😎", "🤓", "🥳", "😺", "🐶", "🦊", "🐼", "🐨", "🐸", "🦁", "🐯", "🐵", "🦄", "🐙", "🐳",
    "🌵", "🌸", "🌈", "⭐", "🔥", "⚡", "🍕", "🍩", "☕", "🎧", "🎮", "⚽", "🏀", "🚀", "💎", "👑"];

  const canvas = $("avCanvas");
  const g = canvas.getContext("2d");
  canvas.width = canvas.height = SIZE;

  let st = null;        // editor state
  let resolveFn = null;

  const lum = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };

  function background() {
    if (st.blend) {
      const gr = g.createLinearGradient(0, 0, SIZE, SIZE);
      gr.addColorStop(0, st.bg);
      gr.addColorStop(1, st.blend);
      g.fillStyle = gr;
    } else {
      g.fillStyle = st.bg;
    }
    g.fillRect(0, 0, SIZE, SIZE);
  }

  // Photo: scale so it always covers the circle, then the zoom and drag on top.
  function photoGeom() {
    const img = st.img;
    const base = Math.max(SIZE / img.naturalWidth, SIZE / img.naturalHeight);
    const s = base * st.zoom;
    const w = img.naturalWidth * s, h = img.naturalHeight * s;
    const maxX = (w - SIZE) / 2, maxY = (h - SIZE) / 2;
    st.ox = Math.max(-maxX, Math.min(maxX, st.ox));
    st.oy = Math.max(-maxY, Math.min(maxY, st.oy));
    return { w, h, x: (SIZE - w) / 2 + st.ox, y: (SIZE - h) / 2 + st.oy };
  }

  function draw() {
    g.clearRect(0, 0, SIZE, SIZE);
    if (st.mode === "photo" && st.img) {
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, SIZE, SIZE);
      const p = photoGeom();
      g.drawImage(st.img, p.x, p.y, p.w, p.h);
    } else if (st.mode === "photo") {
      background();
    } else if (st.mode === "emoji") {
      background();
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.font = `${SIZE * 0.56}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
      g.fillText(st.emoji || "🙂", SIZE / 2, SIZE / 2 + SIZE * 0.04);
    } else {
      background();
      const text = (st.initials || "?").toUpperCase();
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillStyle = lum(st.bg) > 0.45 ? "#32292f" : "#ffffff";
      g.font = `800 ${text.length > 2 ? SIZE * 0.3 : SIZE * 0.38}px Geist, Inter, system-ui, sans-serif`;
      g.fillText(text, SIZE / 2, SIZE / 2 + SIZE * 0.02);
    }
    render();
  }

  function render() {
    // Tabs
    $("avSeg").dataset.mode = { photo: "a", emoji: "b", initials: "c" }[st.mode];
    $("avSeg").querySelectorAll("button").forEach((b) => { const on = b.dataset.m === st.mode; b.classList.toggle("on", on); b.setAttribute("aria-selected", on); });
    $("avPhotoPanel").hidden = st.mode !== "photo";
    $("avEmojiPanel").hidden = st.mode !== "emoji";
    $("avInitPanel").hidden = st.mode !== "initials";
    $("avBgPanel").hidden = st.mode === "photo";
    $("avZoomWrap").hidden = !st.img;
    $("avPick").textContent = st.img ? "Choose another photo" : "Choose a photo";
    canvas.classList.toggle("draggable", st.mode === "photo" && !!st.img);
    // Swatches
    $("avBg").querySelectorAll(".swatch[data-c]").forEach((s) => { const on = s.dataset.c === st.bg; s.classList.toggle("on", on); s.setAttribute("aria-checked", on); });
    $("avBlend").querySelectorAll(".swatch[data-c]").forEach((s) => { const on = (s.dataset.c || null) === st.blend; s.classList.toggle("on", on); s.setAttribute("aria-checked", on); });
    $("avCustom").classList.toggle("on", !SWATCHES.includes(st.bg));
    $("avCustom").style.background = SWATCHES.includes(st.bg) ? "" : st.bg;
    $("avEmojiGrid").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.textContent === st.emoji));
  }

  function swatchRow(el, withNone, onPick) {
    el.innerHTML = (withNone ? '<button class="swatch none" data-c="" role="radio" aria-label="No second colour"></button>' : "") +
      SWATCHES.map((c) => `<button class="swatch" role="radio" data-c="${c}" style="background:${c}" aria-label="Colour ${c}"></button>`).join("");
    el.querySelectorAll(".swatch[data-c]").forEach((s) => (s.onclick = () => { onPick(s.dataset.c || null); draw(); }));
  }

  // ---------- wire up (once) ----------
  swatchRow($("avBg"), false, (c) => (st.bg = c));
  $("avBg").appendChild($("avCustom")); // "any colour" sits at the end of the row
  swatchRow($("avBlend"), true, (c) => (st.blend = c));
  $("avCustomInput").addEventListener("input", (e) => { st.bg = e.target.value; draw(); });
  $("avEmojiGrid").innerHTML = EMOJI.map((e) => `<button type="button" aria-label="${e}">${e}</button>`).join("");
  $("avEmojiGrid").querySelectorAll("button").forEach((b) => (b.onclick = () => { st.emoji = b.textContent; $("avEmojiInput").value = ""; draw(); }));
  $("avEmojiInput").addEventListener("input", (e) => {
    const v = e.target.value;
    const chars = window.Intl?.Segmenter ? [...new Intl.Segmenter().segment(v)].map((x) => x.segment) : Array.from(v);
    const last = chars.filter((c) => c.trim()).pop();
    if (last) { st.emoji = last; draw(); }
  });
  $("avInitials").addEventListener("input", (e) => { st.initials = e.target.value.trim().slice(0, 3); draw(); });
  $("avSeg").querySelectorAll("button").forEach((b) => (b.onclick = () => { st.mode = b.dataset.m; draw(); }));
  $("avZoom").addEventListener("input", (e) => { st.zoom = +e.target.value; draw(); });
  $("avFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const url = await NPay.imageToAvatar(file, 1024);
      const img = new Image();
      img.src = url;
      await img.decode();
      Object.assign(st, { img, zoom: 1, ox: 0, oy: 0, mode: "photo" });
      $("avZoom").value = 1;
      draw();
    } catch (err) { NPay.toast(err.message); }
  });

  // Drag to move the photo (mouse and touch).
  let drag = null;
  canvas.addEventListener("pointerdown", (e) => {
    if (st.mode !== "photo" || !st.img) return;
    canvas.setPointerCapture(e.pointerId);
    const k = SIZE / canvas.getBoundingClientRect().width;
    drag = { x: e.clientX, y: e.clientY, ox: st.ox, oy: st.oy, k };
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    st.ox = drag.ox + (e.clientX - drag.x) * drag.k;
    st.oy = drag.oy + (e.clientY - drag.y) * drag.k;
    draw();
  });
  ["pointerup", "pointercancel"].forEach((t) => canvas.addEventListener(t, () => (drag = null)));
  canvas.addEventListener("wheel", (e) => {
    if (st.mode !== "photo" || !st.img) return;
    e.preventDefault();
    st.zoom = Math.max(1, Math.min(4, st.zoom - e.deltaY * 0.002));
    $("avZoom").value = st.zoom;
    draw();
  }, { passive: false });

  function close(result) {
    $("avatarScreen").classList.remove("open");
    $("avatarScreen").setAttribute("aria-hidden", "true");
    resolveFn?.(result);
    resolveFn = null;
  }
  $("avCancel").onclick = () => close(null);
  $("avSave").onclick = () => {
    // Saved at 320 px: sharp on every screen, small enough to load fast in lists.
    const out = document.createElement("canvas");
    out.width = out.height = 320;
    const og = out.getContext("2d");
    og.imageSmoothingQuality = "high";
    og.drawImage(canvas, 0, 0, 320, 320);
    const avatar = out.toDataURL("image/jpeg", 0.88);
    close({ avatar, color: st.mode === "photo" ? null : st.bg });
  };
  $("avRemove").onclick = () => close({ avatar: null, color: st.bg });

  async function open(user) {
    st = {
      mode: user.avatar ? "photo" : "initials",
      img: null, zoom: 1, ox: 0, oy: 0,
      bg: user.color || "#32292f", blend: null,
      emoji: "😎",
      initials: NPay.initials(user.name),
    };
    // Start from the current picture so "Save" without changes keeps it.
    if (user.avatar) {
      const img = new Image();
      img.src = user.avatar;
      try { await img.decode(); st.img = img; } catch { st.mode = "initials"; }
    }
    $("avInitials").value = st.initials;
    $("avEmojiInput").value = "";
    $("avZoom").value = 1;
    $("avRemove").hidden = !user.avatar;
    draw();
    $("avatarScreen").classList.add("open");
    $("avatarScreen").setAttribute("aria-hidden", "false");
    return new Promise((res) => (resolveFn = res));
  }

  return { open };
})();
