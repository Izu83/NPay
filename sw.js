// NPay service worker: network first, so a new deploy shows up right away;
// the cached copy is only used when the phone is offline.
const CACHE = "npay-v3";
const SHELL = ["./", "index.html", "terminal.html", "css/style.css", "js/config.js", "js/common.js", "js/backend.js", "js/wallet.js", "js/terminal.js", "icon.svg", "icon-192.png", "manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        // Cache the app's own files and the libraries/fonts, never live data from Supabase.
        const host = new URL(e.request.url).host;
        if (res.ok && (host === location.host || /^(cdn\.jsdelivr\.net|fonts\.(googleapis|gstatic)\.com)$/.test(host))) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("./")))
  );
});
