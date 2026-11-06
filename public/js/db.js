/* =====================================================================
 * ALTUĞ KUYUMCULUK - Firebase Bağlantı Katmanı (ES5)
 * =====================================================================
 * Hedef: Toshiba Smart TV'nin eski tarayıcısı.
 * Bu yüzden MODERN (v9+ modüler) SDK DEĞİL, eski "firebase-appular-pre
 * 1.0.0" SDK'sı kullanılır. Bu SDK ES5 uyumludur, callback tabanlıdır.
 *
 * Yükleme sırası (tv.html / admin.html):
 *   1) firebase.js (eski SDK, CDN'den veya /js/lib/ altından yerel)
 *   2) config.js
 *   3) bu dosya
 *
 * Güvenlik: Secret / servis anahtarı İÇERMEZ. TV yalnızca okur; yazma
 * izni Firebase Security Rules ile sadece doğrulanmış yönetime açıktır.
 * ===================================================================== */

var AppDb = (function () {
  "use strict";

  var db = null;
  var useCompat = false; /* true: v8 compat database() / false: 2.x new Firebase() */
  var authSvc = null;
  var storageSvc = null;
  var connected = false;
  var disconnectHandlers = [];

  /* localStorage erişimi güvenli sarmalayıcı (TV sandbox'ında kapalı olabilir) */
  function safeGet(key) {
    try {
      var v = window.localStorage.getItem(key);
      return v;
    } catch (e) { return null; }
  }
  function safeSet(key, value) {
    try { window.localStorage.setItem(key, value); return true; }
    catch (e) { return false; }
  }

  function init() {
    if (db) { return db; }
    if (typeof window.firebase === "undefined" && typeof Firebase === "undefined") {
      throw new Error("Firebase SDK yuklanamadi");
    }
    var cfg = (window.APP_CONFIG && window.APP_CONFIG.firebase) ? window.APP_CONFIG.firebase : {};
    var url = cfg.databaseURL;
    if (!url) {
      throw new Error("APP_CONFIG.firebase.databaseURL bos - once Realtime Database olusturup URL'i config.js'e yazin");
    }
    /* firebase@8 compat (ONEMLI): database() ref API'si yeni URL alan adini
     * (firebasedatabase.app) cozer; 2.4.1 SDK cozEMEZ. Compat varsa o kullanilir. */
    try {
      if (typeof window.firebase !== "undefined" && window.firebase.initializeApp) {
        if (!window.firebase.apps || window.firebase.apps.length === 0) {
          window.firebase.initializeApp(cfg);
        }
        /* apiKey girisi icin gereklidir; yoksa TV salt-okur calismaya devam eder. */
        if (cfg.apiKey && window.firebase.auth) { authSvc = window.firebase.auth(); }
        if (cfg.storageBucket && window.firebase.storage) {
          try { storageSvc = window.firebase.storage(); } catch (e) {}
        }
        if (window.firebase.database) {
          db = window.firebase.database();
          useCompat = true;
        }
      }
    } catch (e) {}
    if (!useCompat) {
      /* Yedek yol: gercekten eski 2.x SDK yuklenmis (firebaseio.com URL'lerinde calisir) */
      if (typeof Firebase === "undefined") {
        throw new Error("Firebase SDK yuklanamadi (compat kopyalari da yok)");
      }
      db = new Firebase(url);
    }
    /* Ilk baglanti basarili kabul edilir; durum dinleyicisi sonrasi tazelemedir. */
    connected = true;
    function fireDisconnect() {
      var i;
      for (i = 0; i < disconnectHandlers.length; i++) {
        try { disconnectHandlers[i](); } catch (e) {}
      }
    }
    if (useCompat) {
      /* compat: baglanti durumu .info/connected yolindan izlenir */
      try {
        db.ref(".info/connected").on("value", function (snap) {
          var c = snap && snap.val() === true;
          if (c) { connected = true; }
          else if (connected) { connected = false; fireDisconnect(); }
        });
      } catch (e) {}
    } else {
      db.on("connected", function () { connected = true; });
      db.on("disconnect", function () { connected = false; fireDisconnect(); });
    }
    return db;
  }

  function ref(path) {
    var root = init();
    return useCompat ? root.ref(path) : root.child(path);
  }

  /* Bir yolu dinle; her değişimde handler(val) çağrılır.
   * ONEMLI: SDK'nin cok-alanli snapshot okumasi bazi tarayicilarda
   * 'isEmpty' ile cokuyor; bu yuzden dinleme REST poll ile yapilir
   * (auth-farkinda restGet; yazma/auth SDK'da kalir). */
  function subscribe(path, handler) {
    return poll(path, handler, 5000);
  }

  /* Bir kez oku (auth-farkinda REST; SDK snapshot cokmesinden bagimsiz). */
  function once(path, handler) {
    restGet(path, function (v) { try { handler(v); } catch (e) {} });
  }

  /* ---------- REST OKUYUCU (SDK cokmesine dayanikli, ES5/XHR) ----------
   * Bazi tarayicilarda v8 compat SDK'sinin COK-ALANLI snapshot assembly'si
   * "Cannot read properties of null (reading 'isEmpty')" ile cokuyor (tek
   * alanli yaprak okumalari sorunsuz). Bu yuzden TV/sayfa okumalari ayni
   * Firebase kaynagina REST (".json") ile poll edilir: XHR her motorda
   * calisir, snapshot assembly yok -> cokme yok. Yazma/auth SDK'da kalir. */
  function restBase() {
    var cfg = (window.APP_CONFIG && window.APP_CONFIG.firebase) || {};
    return cfg.databaseURL || null;
  }
  function restGet(path, cb) {
    cb = cb || function () {};
    var base = restBase();
    if (!base) { cb(null); return; }
    var clean = String(path).replace(/^\/+/, "");
    function doFetch(token) {
      var url = base + "/" + clean + ".json";
      /* Auth token (varsa) ekle: admins/operationLogs gibi auth-isteyen
       * yollar anonim REST'e kapali (403). TV'de authSvc yok -> tokensuz. */
      if (token) { url += "?auth=" + encodeURIComponent(token); }
      try {
        var xhr = new XMLHttpRequest();
        xhr.open("GET", url, true);
        if (xhr.timeout !== undefined) { try { xhr.timeout = 12000; } catch (e) {} }
        xhr.onreadystatechange = function () {
          if (xhr.readyState === 4) {
            if ((xhr.status >= 200 && xhr.status < 300) || xhr.status === 0) {
              var v = null;
              try { v = JSON.parse(xhr.responseText); } catch (e) { v = null; }
              if (v !== null) { connected = true; }
              cb(v);
            } else { cb(null); }
          }
        };
        try { xhr.ontimeout = function () { cb(null); }; } catch (e) {}
        try { xhr.onerror = function () { cb(null); }; } catch (e) {}
        xhr.send();
      } catch (e) { cb(null); }
    }
    try {
      var u = (authSvc && authSvc.currentUser) ? authSvc.currentUser : null;
      if (u && u.getIdToken) {
        var pr = u.getIdToken();
        if (pr && pr.then) { pr.then(function (tok) { doFetch(tok); }, function () { doFetch(null); }); }
        else { doFetch(null); }
      } else { doFetch(null); }
    } catch (e) { doFetch(null); }
  }
  /* Yolu periyodik oku; her yenide handler(val) cagrilir. Ilk cagri aninda. */
  function poll(path, handler, intervalMs) {
    handler = handler || function () {};
    var stopped = false;
    function tick() {
      if (stopped) { return; }
      try { restGet(path, function (v) { try { handler(v); } catch (e) {} }); }
      catch (e) {}
    }
    tick();
    var iv = setInterval(tick, intervalMs || 15000);
    return function () { stopped = true; try { clearInterval(iv); } catch (e) {} };
  }

  /* ---------- YAZMA (REST, auth-token'li) ----------
   * SDK'nin yazma yolu da ayni motor/bundle sorunu yuzunden cokuyor;
   * bu yuzden yazmalar Firebase REST API ile: PATCH/PUT/POST/DELETE. */
  function authToken(cb) {
    try {
      var u = (authSvc && authSvc.currentUser) ? authSvc.currentUser : null;
      if (u && u.getIdToken) {
        var pr = u.getIdToken();
        if (pr && pr.then) { pr.then(function (t) { cb(t); }, function () { cb(null); }); }
        else { cb(null); }
      } else { cb(null); }
    } catch (e) { cb(null); }
  }
  function restSend(method, path, data, cb) {
    cb = cb || function () {};
    var base = restBase();
    if (!base) { cb(new Error("databaseURL bos")); return; }
    var clean = String(path).replace(/^\/+/, "");
    authToken(function (token) {
      if (!token) { cb(new Error("Yazma icin yonetici girisi gerekli")); return; }
      var url = base + "/" + clean + ".json?auth=" + encodeURIComponent(token);
      try {
        var xhr = new XMLHttpRequest();
        xhr.open(method, url, true);
        xhr.onreadystatechange = function () {
          if (xhr.readyState === 4) {
            if (xhr.status >= 200 && xhr.status < 300) {
              var res = null;
              try { res = JSON.parse(xhr.responseText); } catch (e) { res = null; }
              cb(null, res);
            } else { cb(new Error("REST " + method + " HTTP " + xhr.status)); }
          }
        };
        if (method !== "DELETE") {
          try { xhr.setRequestHeader("Content-Type", "application/json"); } catch (e) {}
          xhr.send(JSON.stringify(data === undefined ? null : data));
        } else { xhr.send(); }
      } catch (e) { cb(e); }
    });
  }

  /* compat'te yazma islemleri Promise donerur; cb(null|err) ile standardize et. */
  function promiseOrCb(promiseLike, cb) {
    if (promiseLike && promiseLike.then) {
      promiseLike.then(function (res) { cb(null, res); }, function (err) { cb(err); });
    }
  }

  /* Yönetici yazması (yalnızca giriş yapmış admin çağırabilir). */
  function update(path, obj, cb) { restSend("PATCH", path, obj, cb || function () {}); }
  function set(path, obj, cb) { restSend("PUT", path, obj, cb || function () {}); }
  function remove(path, cb) { restSend("DELETE", path, null, cb || function () {}); }
  function push(path, obj, cb) { restSend("POST", path, obj, cb || function () {}); }

  /* E-posta/şifre ile yönetim girişi */
  function login(email, pass, onSuccess, onError) {
    init();
    /* Once yeni SDK auth (v8 compat), sonra eski authWithPassword yedegi */
    if (authSvc && authSvc.signInWithEmailAndPassword) {
      authSvc.signInWithEmailAndPassword(email, pass).then(function (user) {
        if (onSuccess) { onSuccess({ uid: user.uid, password: { email: email } }); }
      }, function (err) {
        if (onError) { onError(err); }
      });
      return;
    }
    if (db && db.authWithPassword) {
      db.authWithPassword(email, pass, function (err, authData) {
        if (err) { if (onError) { onError(err); } return; }
        if (onSuccess) { onSuccess(authData); }
      });
      return;
    }
    if (onError) { onError(new Error("Auth SDK yuklenemedi - CDN/yerel kopyayi kontrol edin")); }
  }
  function logout() {
    try { if (authSvc) { authSvc.signOut(); } } catch (e) {}
    try { if (db) { db.unauth(); } } catch (e) {}
  }
  function currentUser() {
    try {
      if (authSvc && authSvc.currentUser) {
        var u = authSvc.currentUser;
        return { uid: u.uid, password: { email: u.email } };
      }
      if (db && db.getAuth) { return db.getAuth(); }
    } catch (e) {}
    return null;
  }

  /* Oturum degisikligini dinle.
   * v8 compat: ref().on("auth") YOKTUR (eski 2.x API'sidir) — bu yuzden
   * auth.onAuthStateChanged kullanilir. Eski 2.x yedeginde ref.on("auth").
   * handler({uid, password:{email}} | null) ile standart bicimde cagrilir. */
  function onAuthChange(handler) {
    init();
    function wrap(a) {
      return a ? { uid: a.uid, password: { email: a.email || "" } } : null;
    }
    if (authSvc && authSvc.onAuthStateChanged) {
      return authSvc.onAuthStateChanged(
        function (u) { try { handler(wrap(u)); } catch (e) {} },
        function () { try { handler(null); } catch (e) {} }
      );
    }
    if (db && db.on) {
      try {
        db.on("auth", function (a) { try { handler(a || null); } catch (e) {} });
      } catch (e) { try { handler(db.getAuth()); } catch (e2) {} }
      return function () {};
    }
    try { handler(null); } catch (e) {}
    return function () {};
  }

  function onDisconnect(handler) { disconnectHandlers.push(handler); }
  function isConnected() { return connected; }

  /* Son geçerli veriyi TV kapanıp açıldığında hızlı göstermek için
   * localStorage'a yedekler (okuma izni olan tek alan: marketPrices). */
  function cacheMarket(market) {
    try { safeSet("altug_market_cache", JSON.stringify(market)); } catch (e) {}
  }
  function readMarketCache() {
    try {
      var raw = safeGet("altug_market_cache");
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  /* Firebase Storage'a gorsel yukleme (yalnizca giris yapmis admin).
   * folder: "ads" | "branding" | "products". onDone(err, downloadURL). */
  function uploadImage(file, folder, onProgress, onDone) {
    onDone = onDone || function () {};
    if (!storageSvc) {
      onDone(new Error("Storage yapilandirilmadi - config.js storageBucket doldurun"));
      return;
    }
    if (typeof file === "undefined" || file === null) {
      onDone(new Error("Dosya secilmedi")); return;
    }
    var safeName = String(file.name || "gorsel")
      .replace(/[^a-zA-Z0-9._-]/g, "_").substring(0, 48);
    var path = (folder || "ads") + "/" + Date.now() + "-" + safeName;
    try {
      var reff = storageSvc.ref().child(path);
      var task = reff.put(file);
      task.on("state_changed",
        function (snap) {
          if (onProgress && snap.totalBytes) {
            onProgress(Math.round(snap.bytesTransferred / snap.totalBytes * 100));
          }
        },
        function (err) { onDone(err || new Error("Yukleme hatasi")); },
        function () {
          /* v8 compat: snapshot.ref.getDownloadURL() promise doner */
          task.snapshot.ref.getDownloadURL().then(function (url) {
            onDone(null, url);
          }, function (err) { onDone(err); });
        });
    } catch (e) { onDone(e); }
  }

  return {
    init: init,
    ref: ref,
    subscribe: subscribe,
    once: once,
    poll: poll,
    restGet: restGet,
    update: update,
    set: set,
    remove: remove,
    push: push,
    login: login,
    logout: logout,
    currentUser: currentUser,
    onAuthChange: onAuthChange,
    onDisconnect: onDisconnect,
    isConnected: isConnected,
    cacheMarket: cacheMarket,
    readMarketCache: readMarketCache,
    uploadImage: uploadImage,
    safeGet: safeGet,
    safeSet: safeSet
  };
})();
