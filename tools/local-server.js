/* =====================================================================
 * ALTUG KUYUMCULUK - Yerel Gelistirme Sunucus (bağımlılıksiz, sadece Node)
 * Kullanim:  node tools/local-server.js [port]   (varsayilan: 8080)
 * public/ klasorunu sunur; TV/admin/giris sayfalarina adres verir.
 * NOT: Bu yalnizca gelistirme aracidir; URETIM dagitimi Firebase Hosting
 * ile yapilir (README bolum 4).
 * ===================================================================== */
"use strict";

var http = require("http");
var fs = require("fs");
var path = require("path");

var ROOT = path.join(__dirname, "..", "public");
var PORT = Number(process.argv[2]) || 8080;

var MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

var server = http.createServer(function (req, res) {
  var urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") { urlPath = "/tv.html"; } /* Ana ekran: TV */
  var file = path.join(ROOT, path.normalize(urlPath));
  /* Klasor disina cikisi engelle (ust dizine tirmanma) */
  if (file.indexOf(ROOT) !== 0) {
    res.writeHead(403); res.end("403"); return;
  }
  fs.readFile(file, function (err, buf) {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 bulunamadi: " + urlPath);
      return;
    }
    var ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      /* TV tarayicisi eski; onbellezme tamamen kapatilir (canli test icin) */
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Pragma": "no-cache"
    });
    res.end(buf);
  });
});

server.listen(PORT, function () {
  console.log("Yerel sunucu acildi:");
  console.log("  TV paneli  : http://localhost:" + PORT + "/tv.html");
  console.log("  Yonetim    : http://localhost:" + PORT + "/admin.html");
  console.log("  Giris      : http://localhost:" + PORT + "/login.html");
  console.log("  Otomatik   : http://localhost:" + PORT + "/tests.html");
});
