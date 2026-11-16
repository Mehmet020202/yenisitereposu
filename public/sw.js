/* =====================================================================
 * ALTUĞ KUYUMCULUK - PWA Service Worker
 * Strateji:
 *  - HTML + JS/CSS (uygulama kodu): network-first -> cevrimdisi ise onbellek.
 *    Boylece yeni bir surum yayinlandiginda kullanici ESKI kodu onbellekten
 *    gormeye devam etmez (eski surumdeki "urunler gorunmuyor" sorununun
 *    sebebi cache-first idi).
 *  - Ikon/schrift gibi degismeyen varliklar: cache-first.
 *  - Firebase REST (.json) ve harici originler: ASLA onbelleğe alinmaz.
 *  - Cevrimdisi: kabuk onbellekten acilir; fiyatlar son bilinen degerleri
 *    gosterir ve "Guncel degil" uyarisi zaten UI'da mevcut.
 *
 * NOT: Uygulama kodunu degistiren her yayinda CACHE_NAME surumunu artirin.
 * ===================================================================== */
"use strict";

var CACHE_NAME = "altug-pwa-v4";

/* Goreli yollar: site alt klasorde yayinlansa da (or. /site/) calisir. */
var SHELL = [
  "./",
  "tv.html",
  "offline.html",
  "manifest.webmanifest",
  "css/tv.css",
  "css/theme-2.css",
  "js/lib/firebase.js",
  "js/lib/socket.io.min.js",
  "js/config.js",
  "js/price-validator.js",
  "js/price-engine.js",
  "js/price-formatter.js",
  "js/db.js",
  "js/theme-registry.js",
  "js/theme-manager.js",
  "js/themes/theme-2.js",
  "js/tv.js",
  "icons/icon.svg"
];

self.addEventListener("install", function (ev) {
  ev.waitUntil(
    caches.open(CACHE_NAME).then(function (c) {
      /* Tek bir eksik dosya (or. olmayan ikon) kurulumu cokertmesin. */
      return Promise.all(SHELL.map(function (u) {
        return c.add(new Request(u, { cache: "reload" })).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (ev) {
  ev.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE_NAME) { return caches.delete(k); }
        return Promise.resolve();
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* Uygulama kodu: her zaman agdan tazele; ag yoksa onbellege dus. */
function isAppCode(url) {
  return /\.(?:css|js)$/.test(url.pathname);
}
/* Degismeyen gorsel varliklar. */
function isStaticAsset(url) {
  return /\.(?:png|jpg|jpeg|webp|svg|ico|woff2?|webmanifest)$/.test(url.pathname) ||
    /\/$/.test(url.pathname);
}

self.addEventListener("fetch", function (ev) {
  var req = ev.request;
  if (req.method !== "GET") { return; }

  var url;
  try { url = new URL(req.url); } catch (e) { return; }

  /* Firebase REST / Harem / her seye harici origin: sansiz aga gec. */
  if (url.origin !== self.location.origin) { return; }

  /* Sayfa gezinmesi: network-first -> kabuk -> offline sayfasi */
  if (req.mode === "navigate" || /\.html?$/.test(url.pathname)) {
    ev.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok && res.type === "basic") {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match("offline.html");
        });
      })
    );
    return;
  }

  /* JS/CSS: network-first (eski kod onbellekten servis edilmesin). */
  if (isAppCode(url)) {
    ev.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok && res.type === "basic") {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match(req);
      })
    );
    return;
  }

  /* Ikon/font vb.: cache-first, yoksa agdan alip onbellege yaz. */
  if (isStaticAsset(url)) {
    ev.respondWith(
      caches.match(req).then(function (hit) {
        if (hit) { return hit; }
        return fetch(req).then(function (res) {
          if (res && res.ok && res.type === "basic") {
            var copy = res.clone();
            caches.open(CACHE_NAME).then(function (c) { c.put(req, copy); });
          }
          return res;
        });
      })
    );
  }
  /* .json gibi diger ayni-origin istekleri varsayilan ag davranisinda kalir. */
});
