/* =====================================================================
 * ALTUG KUYUMCULUK - Yonetici Kullanici Olusturma + Bootstrap
 * Kullanim: node tools/create-admin.js <e-posta>
 * 1) Identity Toolkit REST (public apiKey) ile e-posta/sifre kullanicisi
 *    olusturur, rastgele guclu sifre uretir.
 * 2) Girdigi idToken ile admins/rootAdminUid yolunu YAZAR (guwenlik testi
 *    ayrica dogrulanir). NOT: Bu adim Security Rules dagitilmadan ONCE
 *    yapilmalidir (test mode'da yazma aciktir).
 * Sifre terminalde gosterilir; REPoya HIC yazilmaz.
 * ===================================================================== */
"use strict";

var API_KEY = "AIzaSyBEeMawdKM6swedXc4gdI9lHfYccals0vY";
var DB_URL = "https://fiyat-listesi-70102-default-rtdb.europe-west1.firebasedatabase.app";

var email = process.argv[2];
if (!email) { console.error("Kullanim: node tools/create-admin.js <e-posta>"); process.exit(1); }

/* Rastgele guclu sifre (karisik karakterler hariç okunabilir havuz) */
var ALPHA = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
var SYMBOLS = "!@#$%&*+-";
function rnd(n, pool) {
  var out = "";
  var buf = require("crypto").randomBytes(n);
  for (var i = 0; i < n; i++) { out += pool[buf[i] % pool.length]; }
  return out;
}
var password = rnd(10, ALPHA) + rnd(2, SYMBOLS) + rnd(2, "0123456789");

async function post(url, body) {
  var res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  var json = await res.json();
  if (!res.ok) {
    var e = new Error((json.error && json.error.message) || JSON.stringify(json));
    e.status = res.statusCode;
    throw e;
  }
  return json;
}

(async function () {
  console.log("1) Kullanici olusturuluyor: " + email);
  var su;
  try {
    su = await post("https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=" + API_KEY, {
      email: email, password: password, returnSecureToken: true
    });
  } catch (e) {
    if (/OPERATION_NOT_ALLOWED/.test(e.message)) {
      console.error("HATa: Firebase Console > Authentication > Sign-in method > Email/Password ENABLE edilmis olmali.");
      console.error("Adimlar: 1) Console'da acin  2) Ayni komutu tekrar calistin.");
      process.exit(2);
    }
    throw e;
  }
  var uid = su.localId;
  console.log("   OK. UID: " + uid);

  console.log("2) Girdi dogrulama (signInWithPassword) testi...");
  var si = await post("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" + API_KEY, {
    email: email, password: password, returnSecureToken: true
  });
  console.log("   OK. idToken alindi (kid: " + (si.idToken.split(".")[0] ? "jwt" : "?") + ")");

  console.log("3) admins/rootAdminUid bootstrap yazimi (idToken ile)...");
  var res = await fetch(DB_URL + "/admins/rootAdminUid.json?auth=" + si.idToken, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(uid)
  });
  console.log("   PUT -> " + res.statusCode + " " + (await res.text()).substring(0, 120));
  if (res.statusCode !== 200) {
    console.error("HATa: yazim basarisiz. Rules dagitilmis olabilir (bootstrap once yapilmali).");
    process.exit(1);
  }

  var back = await fetch(DB_URL + "/admins/rootAdminUid.json").then(function (r) { return r.text(); });
  console.log("4) Geri okuma: " + back);

  console.log("");
  console.log("=== YONETICI GIRIS BILGILERI (bir yere not edin) ===");
  console.log("E-posta : " + email);
  console.log("Sifre   : " + password);
  console.log("UID     : " + uid);
})();
