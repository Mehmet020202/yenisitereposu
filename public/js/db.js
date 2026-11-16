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
  var activeStreamCount = 0;
  var maxActiveStreams = 5;

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

  /* Bir yolu dinle; RTDB REST SSE varsa anlik akisi kullan, eski tarayici
   * veya ag hatasinda auth-farkinda REST poll'a geri don. */
  function subscribe(path, handler, intervalMs) {
    handler = handler || function () {};
    if (!window.EventSource || !window.EventSource.prototype ||
        !window.EventSource.prototype.addEventListener) {
      return poll(path, handler, intervalMs || 5000);
    }
    if (activeStreamCount >= maxActiveStreams) {
      return poll(path, handler, intervalMs || 5000);
    }
    activeStreamCount++;
    var stopStream = streamSubscribe(path, handler, intervalMs || 5000);
    var released = false;
    return function () {
      if (released) { return; }
      released = true;
      activeStreamCount--;
      stopStream();
    };
  }

  /* Bir kez oku (auth-farkinda REST; SDK snapshot cokmesinden bagimsiz). */
  function streamToken(forceRefresh, callback) {
    try {
      var user = authSvc && authSvc.currentUser;
      if (!user || !user.getIdToken) { callback(null, null); return; }
      var result = user.getIdToken(forceRefresh === true);
      if (result && result.then) {
        result.then(function (token) { callback(token, null); }, function (err) {
          callback(null, err || new Error("Firebase SSE token alinamadi"));
        });
      } else {
        callback(result || null, null);
      }
    } catch (e) { callback(null, e); }
  }

  function setStreamValue(value, path, nextValue) {
    var parts = String(path || "/").split("/");
    var cleanParts = [], i, node, key;
    for (i = 0; i < parts.length; i++) {
      if (parts[i]) { cleanParts.push(parts[i]); }
    }
    if (cleanParts.length === 0) { return nextValue; }
    if (!value || typeof value !== "object") { value = {}; }
    node = value;
    for (i = 0; i < cleanParts.length - 1; i++) {
      key = cleanParts[i];
      if (!node[key] || typeof node[key] !== "object") { node[key] = {}; }
      node = node[key];
    }
    key = cleanParts[cleanParts.length - 1];
    if (nextValue === null) { delete node[key]; }
    else { node[key] = nextValue; }
    return value;
  }

  function streamSubscribe(path, handler, fallbackInterval) {
    var stopped = false;
    var source = null;
    var sourceGeneration = 0;
    var stopPoll = null;
    var initialTimer = null;
    var lastValue = null;
    var hasValue = false;

    function warn(message) {
      if (window.console && console.warn) { console.warn(message); }
    }
    function startPolling() {
      if (stopped || stopPoll) { return; }
      if (initialTimer) { clearTimeout(initialTimer); initialTimer = null; }
      stopPoll = poll(path, function (value, error) {
        if (!error) {
          lastValue = value;
          hasValue = true;
        }
        try { handler(value, error || null); } catch (e) {
          warn("Firebase abonelik handler hatasi (" + path + "): " + e.message);
        }
      }, fallbackInterval);
    }
    function closeStream() {
      sourceGeneration++;
      if (source) {
        try { source.close(); } catch (e) {}
        source = null;
      }
    }
    function emitValue() {
      if (!hasValue) { return; }
      connected = true;
      if (stopPoll) { stopPoll(); stopPoll = null; }
      if (initialTimer) { clearTimeout(initialTimer); initialTimer = null; }
      try { handler(lastValue, null); } catch (e) {
        warn("Firebase stream handler hatasi (" + path + "): " + e.message);
      }
    }
    function openStream(token) {
      if (stopped) { return; }
      var cfg = (window.APP_CONFIG && window.APP_CONFIG.firebase) || {};
      if (!cfg.databaseURL) { startPolling(); return; }
      var clean = String(path).replace(/^\/+/, "");
      var url = cfg.databaseURL + "/" + clean + ".json";
      if (token) { url += "?auth=" + encodeURIComponent(token); }
      var generation = ++sourceGeneration;
      var thisSource;
      try {
        thisSource = new window.EventSource(url);
        source = thisSource;
      } catch (e) {
        warn("Firebase SSE baslatilamadi (" + path + "): " + e.message);
        startPolling();
        return;
      }
      function current() {
        return !stopped && source === thisSource && generation === sourceGeneration;
      }
      function onData(event, isPatch) {
        if (!current()) { return; }
        var message;
        try { message = JSON.parse(event.data); } catch (e) {
          warn("Firebase SSE verisi okunamadi (" + path + ")");
          startPolling();
          return;
        }
        if (!message || typeof message.path !== "string") { return; }
        if (isPatch) {
          if (!message.data || typeof message.data !== "object") { return; }
          for (var child in message.data) {
            if (Object.prototype.hasOwnProperty.call(message.data, child)) {
              lastValue = setStreamValue(lastValue, message.path + "/" + child,
                message.data[child]);
            }
          }
          hasValue = true;
        } else {
          lastValue = setStreamValue(lastValue, message.path, message.data);
          hasValue = true;
        }
        emitValue();
      }
      thisSource.addEventListener("put", function (event) { onData(event, false); });
      thisSource.addEventListener("patch", function (event) { onData(event, true); });
      thisSource.addEventListener("cancel", function (event) {
        if (!current()) { return; }
        connected = false;
        warn("Firebase SSE erisimi reddedildi (" + path + "): " + event.data);
        closeStream();
        startPolling();
      });
      thisSource.addEventListener("auth_revoked", function (event) {
        if (!current()) { return; }
        connected = false;
        warn("Firebase SSE token yenileniyor (" + path + "): " + event.data);
        closeStream();
        startPolling();
        streamToken(true, function (freshToken, error) {
          if (stopped) { return; }
          if (error || !freshToken) {
            warn("Firebase SSE token yenilenemedi (" + path + ")");
            startPolling();
          } else {
            openStream(freshToken);
          }
        });
      });
      thisSource.onerror = function () {
        if (current()) {
          connected = false;
          startPolling();
        }
      };
    }

    initialTimer = setTimeout(function () {
      initialTimer = null;
      startPolling();
    }, 12000);
    streamToken(false, function (token, error) {
      if (stopped) { return; }
      if (error) {
        warn("Firebase SSE token alinamadi (" + path + "): " + error.message);
        startPolling();
      } else {
        openStream(token);
      }
    });

    return function () {
      stopped = true;
      if (initialTimer) { clearTimeout(initialTimer); initialTimer = null; }
      if (stopPoll) { stopPoll(); stopPoll = null; }
      closeStream();
    };
  }

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
    if (!base) { cb(null, new Error("databaseURL bos")); return; }
    var clean = String(path).replace(/^\/+/, "");
    var completed = false;
    function finish(value, error) {
      if (completed) { return; }
      completed = true;
      if (!error && value !== null) { connected = true; }
      cb(value, error || null);
    }
    function doFetch(token, retried) {
      var url = base + "/" + clean + ".json";
      /* Auth token (varsa) ekle: admins/operationLogs gibi auth-isteyen
       * yollar anonim REST'e kapali (403). TV'de authSvc yok -> tokensuz. */
      if (token) { url += "?auth=" + encodeURIComponent(token); }
      try {
        var xhr = new XMLHttpRequest();
        var requestDone = false;
        xhr.open("GET", url, true);
        if (xhr.timeout !== undefined) { try { xhr.timeout = 12000; } catch (e) {} }
        xhr.onreadystatechange = function () {
          if (xhr.readyState !== 4 || requestDone) { return; }
          requestDone = true;
          if (xhr.status >= 200 && xhr.status < 300) {
            try { finish(JSON.parse(xhr.responseText), null); }
            catch (e) { finish(null, new Error("Firebase REST yaniti JSON olarak okunamadi")); }
          } else if (xhr.status === 401 && token && !retried && authSvc && authSvc.currentUser) {
            try {
              authSvc.currentUser.getIdToken(true).then(function (freshToken) {
                doFetch(freshToken, true);
              }, function (e) {
                finish(null, e || new Error("Firebase kimlik belirteci yenilenemedi"));
              });
            } catch (e) { finish(null, e); }
          } else {
            finish(null, new Error("Firebase REST GET HTTP " + xhr.status));
          }
        };
        try { xhr.ontimeout = function () {
          if (!requestDone) { requestDone = true; finish(null, new Error("Firebase REST GET zaman asimi")); }
        }; } catch (e) {}
        try { xhr.onerror = function () {
          if (!requestDone) { requestDone = true; finish(null, new Error("Firebase REST GET ag hatasi (HTTP 0)")); }
        }; } catch (e) {}
        xhr.send();
      } catch (e) { finish(null, e); }
    }
    try {
      var u = (authSvc && authSvc.currentUser) ? authSvc.currentUser : null;
      if (u && u.getIdToken) {
        var pr = u.getIdToken();
        if (pr && pr.then) { pr.then(function (tok) { doFetch(tok, false); }, function () { doFetch(null, false); }); }
        else { doFetch(null, false); }
      } else { doFetch(null, false); }
    } catch (e) { doFetch(null, false); }
  }
  /* Yolu aralikli oku; hata durumunda son basarili degeri koru ve backoff uygula. */
  function poll(path, handler, intervalMs) {
    handler = handler || function () {};
    var stopped = false;
    var timer = null;
    var baseMs = intervalMs || 15000;
    var lastValue = null;
    var hasValue = false;
    var failures = 0;
    function tick() {
      if (stopped) { return; }
      try {
        restGet(path, function (v, error) {
          if (stopped) { return; }
          if (error) {
            failures++;
            if (window.console && console.warn) { console.warn("Firebase poll hatasi (" + path + "): " + error.message); }
          } else {
            lastValue = v;
            hasValue = true;
            failures = 0;
          }
          try { handler(hasValue ? lastValue : null, error || null); } catch (e) {}
          var delay = error ? Math.min(baseMs * Math.pow(2, failures), 60000) : baseMs;
          timer = setTimeout(tick, delay);
        });
      } catch (e) {
        failures++;
        if (window.console && console.warn) { console.warn("Firebase poll hatasi (" + path + "): " + e.message); }
        timer = setTimeout(tick, Math.min(baseMs * Math.pow(2, failures), 60000));
      }
    }
    tick();
    return function () { stopped = true; try { if (timer) { clearTimeout(timer); } } catch (e) {} };
  }

  /* ---------- YAZMA (REST, auth-token'li) ----------
   * SDK'nin yazma yolu da ayni motor/bundle sorunu yuzunden cokuyor;
   * bu yuzden yazmalar Firebase REST API ile: PATCH/PUT/POST/DELETE. */
  function authToken(cb, forceRefresh) {
    try {
      var u = (authSvc && authSvc.currentUser) ? authSvc.currentUser : null;
      if (u && u.getIdToken) {
        var pr = u.getIdToken(forceRefresh === true);
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
      function send(currentToken, retried) {
        var url = base + "/" + clean + ".json?auth=" + encodeURIComponent(currentToken);
        var requestDone = false;
        function fail(error) {
          if (requestDone) { return; }
          requestDone = true;
          cb(error);
        }
      try {
        var xhr = new XMLHttpRequest();
        xhr.open(method, url, true);
        if (xhr.timeout !== undefined) { try { xhr.timeout = 15000; } catch (e) {} }
        xhr.onreadystatechange = function () {
          if (xhr.readyState === 4 && !requestDone) {
            if (xhr.status >= 200 && xhr.status < 300) {
              requestDone = true;
              var res = null;
              try { res = JSON.parse(xhr.responseText); } catch (e) { res = null; }
              cb(null, res);
            } else if (xhr.status === 401 && !retried && authSvc && authSvc.currentUser) {
              requestDone = true;
              authToken(function (freshToken) {
                if (freshToken) { send(freshToken, true); }
                else { cb(new Error("Firebase kimlik belirteci yenilenemedi")); }
              }, true);
            } else { fail(new Error("REST " + method + " HTTP " + xhr.status)); }
          }
        };
        try { xhr.ontimeout = function () { fail(new Error("REST " + method + " zaman asimi")); }; } catch (e) {}
        try { xhr.onerror = function () { fail(new Error("REST " + method + " ag hatasi (HTTP 0)")); }; } catch (e) {}
        if (method !== "DELETE") {
          try { xhr.setRequestHeader("Content-Type", "application/json"); } catch (e) {}
          xhr.send(JSON.stringify(data === undefined ? null : data));
        } else { xhr.send(); }
      } catch (e) { fail(e); }
      }
      send(token, false);
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
