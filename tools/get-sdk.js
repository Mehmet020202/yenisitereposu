/* =====================================================================
 * ALTUG KUYUMCULUK - Firebase v8 yerel SDK kopyasi
 * public/js/lib/firebase.js altina indirir (CDN engelliyse son cares).
 * Kaynak: cdnjs'deki v8.10.1 MONOLITIK UMD bundle (app+auth+database+storage
 * tek dosyada; global: kucuk harfli `firebase`). npm paketinde UMD YOKTUR,
 * gstatic bu agdan engelli olabilir - bu yuzden cdnjs birincidir.
 * Kullanim: node tools/get-sdk.js
 * ===================================================================== */
"use strict";

var fs = require("fs");
var path = require("path");
var https = require("https");

var DIR = path.join(__dirname, "..", "public", "js", "lib");
var FILES = ["firebase.min.js"];
var BASES = [
  "https://cdnjs.cloudflare.com/ajax/libs/firebase/8.10.1/"
];

function get(url) {
  return new Promise(function (resolve, reject) {
    var req = https.get(url, { timeout: 20000 }, function (res) {
      if (res.statusCode >= 301 && res.statusCode <= 308 && res.headers.location) {
        res.resume();
        return resolve(get(new URL(res.headers.location, url).toString()));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error("HTTP " + res.statusCode));
      }
      var chunks = [];
      res.on("data", function (d) { chunks.push(d); });
      res.on("end", function () { resolve(Buffer.concat(chunks)); });
    });
    req.on("error", reject);
    req.on("timeout", function () { req.destroy(); reject(new Error("timeout")); });
  });
}

(async function () {
  fs.mkdirSync(DIR, { recursive: true });
  var fail = 0;
  for (var f = 0; f < FILES.length; f++) {
    var file = FILES[f], ok = false;
    for (var b = 0; b < BASES.length && !ok; b++) {
      var url = BASES[b] + file;
      try {
        var buf = await get(url);
        if (buf.length < 1000) { throw new Error("dosya cok kucuk (" + buf.length + ")"); }
        fs.writeFileSync(path.join(DIR, "firebase.js"), buf);
        console.log(file + " OK  (" + Math.round(buf.length / 1024) + " KB)  <- " + BASES[b]);
        ok = true;
      } catch (e) {
        console.log(file + "  denendi, olmaz: " + e.message);
      }
    }
    if (!ok) { fail++; }
  }
  console.log(fail === 0 ? "TUM SDK KOPYALARI HAZIR" : fail + " dosya indirilemedi");
  process.exitCode = fail === 0 ? 0 : 1;
})();
