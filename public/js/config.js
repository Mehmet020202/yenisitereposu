/* =====================================================================
 * ALTUĞ KUYUMCULUK - Ortak Yapılandırma
 * =====================================================================
 * Bu proje Toshiba Smart TV'nin ESKI tarayicisini hedefledigi icin
 * modern (v9+ moduler import) SDK DEĞIL, v8 "compat" (eski API) SDK'si
 * kullaniir. Bu yuzden Firebase console'un verdigi "import" snippet'i
 * degil, asagidaki DUZ nesne (window.APP_CONFIG) esas alinmistir.
 * Ayni anahtarlar gezerlidir; yalnizca bicim farklidir.
 *
 * ANAHTAR GIZLILIGI: apiKey / authDomain / appId HERKese acik web
 * kimlikleridir, frontend'e yazilmasi GAVENTEDIR. Gercek gizli anahtarlar
 * (Database secret / servis hesabi anahtari) BURADA YAZILMAZ; yalnizca
 * bulut hizmetinin Secret Manager degerlerinde tutulur.
 * ===================================================================== */

window.APP_CONFIG = {
  /* Firebase web yapilandirmasi (kullanicinin projeden aldigi degerler). */
  firebase: {
    apiKey: "AIzaSyBEeMawdKM6swedXc4gdI9lHfYccals0vY",
    authDomain: "fiyat-listesi-70102.firebaseapp.com",
    projectId: "fiyat-listesi-70102",
    storageBucket: "fiyat-listesi-70102.firebasestorage.app",
    messagingSenderId: "733841155572",
    appId: "1:733841155572:web:9ae9a8107f2bc6e50d45a1",
    measurementId: "G-BPCG6XD4CH",

    /* Dogrulandi: veritabani europe-west1 bolgesinde ACIK ve erisilebilir
     * (canli HTTP testi ile teyit edildi). */
    databaseURL: "https://fiyat-listesi-70102-default-rtdb.europe-west1.firebasedatabase.app"
  },

  /* Veri tazellik siniri (ms). Bu suareden eski fiyat "guncel degil" sayilir. */
  staleLimitMs: 180000,

  /* Ani fiyat degisikligi dogrulama esiği (oran). */
  maxJumpRatio: 0.30,

  /* Yedek: bulut hizmeti uzun sure veri getirmezse (veya Firebase fiyati
   * bayat kalirsa) TV dogrudan Harem Socket.IO'ya baglanip CANLI fiyati
   * kendisi cekir. Bu DEGER YALNIZ ekranda gosterilir; Firebase'e YAZILMAZ.
   * Hibrit model: Firebase birincil, Harem yedek. true/false. */
  allowBrowserFallback: true,

  /* Marka */
  brandName: "ALTUĞ KUYUMCULUK"
};
