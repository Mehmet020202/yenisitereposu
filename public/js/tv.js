/* =====================================================================
 * ALTUĞ KUYUMCULUK - TV Ekran Makine Kodu (ES5, Toshiba Smart TV uyumlu)
 * =====================================================================
 * Dayaniklilik kurallari (bellekteki savunma stratejisi):
 *  - Her giris fonksiyonu try/catch ile sarilir -> beyaz ekran yok.
 *  - Harici SDK yoklugunda (Firebase tanimsiz) son onbellek gosterilir.
 *  - localStorage erisimi safeGet/safeSet üzerinden.
 *  - Optional chaining / template literal / ok simi KULLANILMAZ.
 *  - Sayfa hic yenilenmez; yalnizca degisen alanlar guncellenir.
 * ===================================================================== */

(function () {
  "use strict";

  var state = {
    market: null,
    settings: null,
    products: null,
    adjustments: null,
    ads: null,
    branding: null,
    status: null
  };
  var adIndex = 0;
  var adTimer = null;
  var lastProductCount = 0;

  function byId(id) { return document.getElementById(id); }
  function setText(id, text) {
    var el = byId(id);
    if (el && el.firstChild) { el.firstChild.nodeValue = text; }
    else if (el) { el.appendChild(document.createTextNode(text)); }
  }

  /* ---------- 1) SAAT (her zaman calisir, SDK'dan bagimsiz) ---------- */
  function startClock() {
    function tick() {
      try {
        var now = new Date();
        setText("tv-clock", PriceFormatter.formatClock(now));
        setText("tv-date", PriceFormatter.formatDate(now.getTime()));
      } catch (e) {}
    }
    tick();
    setInterval(tick, 1000);
  }

  /* ---------- 2) RENDER: sadece degisen alanlari gunceller ---------- */
  /* Tasarim katmani kancalari (TALIMAT bolum 7/9): veri katmani TEK'tir;
   * ThemeManager gorunen koku cevirir, Theme2 ayni state nesnesini
   * kendi DOM'ina cizer. Baglantilara/abonelıklere dokunulmaz. */
  function renderTheme2() {
    try { if (window.Theme2) { Theme2.render(state); } } catch (e) {}
  }
  function renderAll() {
    try { ThemeManager.sync(state.settings); } catch (e) {}
    try { applyTheme(); renderThemeToggle(); } catch (e) {}
    try { renderProducts(); } catch (e) {}
    try { renderCurrencies(); } catch (e) {}
    try { renderWhatsApp(); } catch (e) {}
    try { renderUpdated(); } catch (e) {}
    try { renderLiveDot(); } catch (e) {}
    try { renderTheme2(); } catch (e) {}
  }

  /* Tema: settings.theme = "dark" | "light" | "navy" | "classic".
   * Oncelik sirasi: URL ?theme > BU EKRANDA secilen (localStorage) > settings.theme > dark.
   * TV'deki tema butonu yalnizca kendi cihazini degistirir (localStorage); Firebase'e
   * YAZMAZ. Admin'deki settings.theme varsayilan kaynak olmaya devam eder. ES5 guvenli. */
  var THEME_ORDER = ["dark", "light", "navy", "classic"];
  function currentTheme() {
    var allowed = { dark: 1, light: 1, navy: 1, classic: 1 };
    var theme = (state.settings && state.settings.theme) || "dark";
    try {
      if (AppDb && AppDb.safeGet) {
        var saved = AppDb.safeGet("altug_tv_theme");
        if (saved && allowed[saved]) { theme = saved; }
      }
    } catch (e) {}
    /* Onizleme/test: tv.html?theme=<ad> Firebase'e dokunmadan temayi zorlar. */
    var tm = (window.location.search || "").match(/[?&]theme=(dark|light|navy|classic)/);
    if (tm) { theme = tm[1]; }
    if (!allowed[theme]) { theme = "dark"; }
    return theme;
  }
  function applyTheme() {
    var b = document.body;
    if (!b) { return; }
    var theme = currentTheme();
    var parts = (b.className || "").split(/\s+/);
    var out = [], i;
    for (i = 0; i < parts.length; i++) {
      if (parts[i] && parts[i].indexOf("theme-") !== 0) { out.push(parts[i]); }
    }
    out.push("theme-" + theme);
    b.className = out.join(" ");
  }
  /* Sag-alt tema butonu: bir sonraki temaya doner ve secimi bu cihazda saklar. */
  function cycleTheme() {
    var cur = currentTheme();
    var idx = 0, i;
    for (i = 0; i < THEME_ORDER.length; i++) { if (THEME_ORDER[i] === cur) { idx = i; break; } }
    var next = THEME_ORDER[(idx + 1) % THEME_ORDER.length];
    try { if (AppDb && AppDb.safeSet) { AppDb.safeSet("altug_tv_theme", next); } } catch (e) {}
    applyTheme();
  }
  function renderThemeToggle() {
    var btn = byId("tv-theme-toggle");
    if (!btn) { return; }
    var show = true;
    if (state.settings && typeof state.settings.showThemeSwitcher !== "undefined") {
      show = state.settings.showThemeSwitcher !== false;
    }
    btn.style.display = show ? "flex" : "none";
  }
  /* WhatsApp butonu: settings.whatsapp* alanlarindan wa.me baglantisi uretir.
   * Varsayilan: acik + magaza numarasi. Firebase'e yazmaz, ES5 guvenli. */
  function renderWhatsApp() {
    var el = byId("tv-whatsapp");
    if (!el) { return; }
    var s = state.settings || {};
    var enabled = s.whatsappEnabled !== false;
    var num = String(s.whatsappNumber || "").replace(/[^0-9]/g, "");
    if (!num) { num = "905432405202"; }
    var msg = s.whatsappMessage || "Merhaba, güncel altın fiyatları hakkında bilgi almak istiyorum.";
    if (!enabled) { el.style.display = "none"; return; }
    try {
      el.setAttribute("href", "https://wa.me/" + num + "?text=" + encodeURIComponent(msg));
    } catch (e) {}
    el.style.display = "inline-block";
  }

  function effectiveStale() {
    if (!state.market) { return true; }
    var info = PriceFormatter.freshnessInfo(
      state.market.updatedAt, Date.now(),
      (window.APP_CONFIG && window.APP_CONFIG.staleLimitMs) || 180000
    );
    return !info.fresh;
  }

  function renderProducts() {
    if (!state.products || !state.market) { return; }
    var body = byId("tv-products-body");
    if (!body) { return; }

    var displayMode = (state.settings && state.settings.goldDisplayMode) || "both";
    var showBuy = displayMode !== "sell";
    var showSell = displayMode !== "buy";

    var head = byId("tv-products-head");
    if (head) {
      var hBuy = byId("tv-col-buy"), hSell = byId("tv-col-sell");
      if (hBuy) { hBuy.style.display = showBuy ? "" : "none"; }
      if (hSell) { hSell.style.display = showSell ? "" : "none"; }
    }

    /* Siralama: order alanina gore */
    var list = [];
    var id, p;
    for (id in state.products) {
      if (!state.products.hasOwnProperty(id)) { continue; }
      p = state.products[id];
      if (!p || p.archived === true || p.active === false) { continue; }
      if (p.tvVisible === false) { continue; }
      p._id = id;
      list.push(p);
    }
    list.sort(function (a, b) {
      var oa = typeof a.order === "number" ? a.order : 9999;
      var ob = typeof b.order === "number" ? b.order : 9999;
      return oa - ob;
    });

    /* Satir sayisina gore font kucultme (tasama yok) */
    body.className = "rows-" + (list.length <= 8 ? "8" :
      list.length <= 11 ? "11" : list.length <= 14 ? "14" : "18");

    var html = "";
    /* Ortak HAS referansinin yonu: tum altin satirlari ayni referanstan
     * hesaplandigina gore tek yon oku satirin sagindaki yon hucresinde
     * gosterilir (sunum amacli; hesap mantigi degismedi). */
    var dirField = (state.settings && state.settings.goldReference) === "has_sell"
      ? "hasSellDir" : "hasBuyDir";
    var refDir = state.market ? state.market[dirField] : null;
    var dirCell = refDir === "up"
      ? '<span class="tv-cell-dir"><span class="tv-dir-up">\u2197</span></span>'
      : refDir === "down"
      ? '<span class="tv-cell-dir"><span class="tv-dir-down">\u2198</span></span>'
      : '<span class="tv-cell-dir"></span>';
    var i, calc, name, buyTxt, sellTxt;
    for (i = 0; i < list.length; i++) {
      p = list[i];
      calc = PriceEngine.calcProduct(p, state.market, state.settings);
      name = p.name || p._id;
      buyTxt = calc && calc.buy !== null ? PriceFormatter.formatTL(calc.buy) : "-";
      sellTxt = calc && calc.sell !== null ? PriceFormatter.formatTL(calc.sell) : "-";
      html += '<div class="tv-row">' +
        '<span class="tv-cell-icon">' + iconFor(name) + '</span>' +
        '<span class="tv-cell-name">' + escapeHtml(name) + '</span>' +
        '<span class="tv-cell-price tv-buy"' + (showBuy ? '' : ' style="display:none"') + '>' + buyTxt + '</span>' +
        '<span class="tv-cell-price tv-sell"' + (showSell ? '' : ' style="display:none"') + '>' + sellTxt + '</span>' +
        dirCell +
        '</div>';
    }
    body.innerHTML = html;
    if (displayMode !== "both") {
      /* Tek modda fiyat hucreleri genisler */
      var rows = body.getElementsByTagName("div");
      var j;
      for (j = 0; j < rows.length; j++) {
        rows[j].className = "tv-row tv-row-wide";
      }
    }
    lastProductCount = list.length;
    try { fitProducts(list.length); } catch (e) {}
  }

  /* fitProducts: ekran boyutu ne olursa olsun TUM urun satirlari kaydirma/kesilme
   * olmadan gorunsun. Panelin kullanilabilir yuksekligi satir sayisina bolunur;
   * satir yuksekligi ve yazi boyutu buna gore otomatik ayarlanir, kaydirma
   * kapatilir. Dar ekranlarda (tablet/mobil <=1180px; fiyatlar tek satira sigmadigi
   * icin CSS iki satirli karta gecer) JS inline olculeri temizler, sayfa kaydurmasi
   * devrede kalir (okunabilirlik icin). ES5 guvenli; layout/renkler korunur. */
  function fitProducts(n) {
    var body = byId("tv-products-body");
    if (!body) { return; }
    var narrow = (window.innerWidth && window.innerWidth <= 1180);
    var rows = body.children, i, r, ic, pi;
    if (narrow) {
      /* dar ekran: sabit yukseklikleri kaldir, CSS auto yapsin, kaydirma acik */
      for (i = 0; i < rows.length; i++) {
        r = rows[i];
        if (r && r.style) { r.style.height = ""; r.style.marginTop = ""; r.style.fontSize = ""; }
        if (r && r.querySelector) {
          ic = r.querySelector(".tv-cell-icon");
          if (ic) { ic.style.width = ""; ic.style.height = ""; ic.style.lineHeight = ""; ic.style.marginRight = ""; }
          pi = r.querySelector(".p-ico");
          if (pi) { pi.style.width = ""; pi.style.height = ""; }
        }
      }
      body.style.overflowY = "auto";
      return;
    }
    if (!n) { return; }
    var avail = body.clientHeight;
    if (!avail || avail < 40) {
      /* Urun alani cok kucuk: onceden yazilmis inline hidden kalarak satirlari
       * GIZLI kesmesin; kaydirilabilir birak (hic olmazsa erisilebilir). */
      body.style.overflowY = "auto";
      return;
    }
    var gap = n > 14 ? 3 : (n > 9 ? 5 : 8);
    var rowH = Math.floor((avail - (n - 1) * gap) / n);
    if (rowH > 84) { rowH = 84; }
    if (rowH < 14) { rowH = 14; }
    var allowScroll = false;
    if (n * rowH + (n - 1) * gap > avail) {
      /* min satirla bile sigmadi: araligi daralt; hala olmassa kaydirma birak (gizli kirpma) */
      gap = 2;
      rowH = Math.floor((avail - (n - 1) * gap) / n);
      if (rowH < 14) { rowH = 14; }
      if (n * rowH + (n - 1) * gap > avail) { allowScroll = true; }
    }
    var font = Math.round(rowH * 0.42);
    if (font < 10) { font = 10; }
    if (font > 30) { font = 30; }
    var icon = Math.round(rowH * 0.62);
    if (icon < 16) { icon = 16; }
    if (icon > 50) { icon = 50; }
    var icoSize = Math.round(icon * 0.5);
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      if (!r || !r.style) { continue; }
      r.style.height = rowH + "px";
      r.style.marginTop = (i === 0 ? 0 : gap) + "px";
      r.style.fontSize = font + "px";
      if (r.querySelector) {
        ic = r.querySelector(".tv-cell-icon");
        if (ic) {
          ic.style.width = icon + "px";
          ic.style.height = icon + "px";
          ic.style.lineHeight = icon + "px";
          ic.style.marginRight = Math.round(icon * 0.34) + "px";
          pi = r.querySelector(".p-ico");
          if (pi) { pi.style.width = icoSize + "px"; pi.style.height = icoSize + "px"; }
        }
      }
    }
    body.style.overflowY = allowScroll ? "auto" : "hidden";
  }

  function renderCurrencies() {
    if (!state.market) { return; }
    var s = state.settings || {};
    var showSection = s.currencySectionHidden !== true;
    var usdRes = PriceEngine.calcUsd(state.market, state.adjustments || {});
    var eurRes = PriceEngine.calcEur(state.market, state.adjustments || {});

    applyCur("tv-usd", showSection && s.showUsd !== false, usdRes, s.usdShowMode || "both");
    applyCur("tv-eur", showSection && s.showEur !== false, eurRes, s.eurShowMode || "both");
  }

  function applyCur(boxId, visible, res, mode) {
    var box = byId(boxId);
    if (!box) { return; }
    box.style.display = visible ? "" : "none";
    if (!visible) { return; }
    var els = box.getElementsByTagName("span");
    var i;
    for (i = 0; i < els.length; i++) {
      var k = els[i].getAttribute("data-cur");
      var isBuy = (k === "usd-buy" || k === "eur-buy");
      var isSell = (k === "usd-sell" || k === "eur-sell");
      if (!isBuy && !isSell) { continue; }
      els[i].style.display = (isBuy ? mode !== "sell" : mode !== "buy") ? "" : "none";
      /* Harem yon alani (or. usdBuyDir): artissa ▲, dusesse ▼ */
      var dir = state.market ? state.market[k.substring(0, 3) + (isBuy ? "BuyDir" : "SellDir")] : null;
      var arrow = dir === "up" ? " \u25B2" : dir === "down" ? " \u25BC" : "";
      var val = isBuy ? res.buy : res.sell;
      var txt = (val !== null ? PriceFormatter.formatCurrencyTL(val) : "-") + arrow;
      if (els[i].firstChild) { els[i].firstChild.nodeValue = txt; }
      else { els[i].appendChild(document.createTextNode(txt)); }
    }
  }

  function renderUpdated() {
    if (!state.market) { return; }
    var stale = effectiveStale();
    setText("tv-updated", state.market.updatedAt ?
      PriceFormatter.formatDateTime(state.market.updatedAt) : "-");
    var bar = byId("tv-stale-bar");
    if (bar) { bar.style.display = stale ? "block" : "none"; }
    var note = byId("tv-note");
    if (note && state.settings) {
      note.firstChild && (note.firstChild.nodeValue = state.settings.tvNote || "");
    }
  }

  function renderLiveDot() {
    var dot = byId("tv-live-dot"), txt = byId("tv-live-text");
    if (!dot || !txt) { return; }
    var st = state.status && state.status.harem ? state.status.harem : "unknown";
    var viaFallbackFresh = fbAppliedAt > 0 &&
      (Date.now() - fbAppliedAt) < ((window.APP_CONFIG && window.APP_CONFIG.staleLimitMs) || 180000);
    var live = !effectiveStale() &&
      ((AppDb.isConnected() && st === "connected") || viaFallbackFresh);
    dot.className = "dot " + (live ? "dot-green" : (st === "connected" || viaFallbackFresh ? "dot-amber" : "dot-red"));
    var label = txt.firstChild ? txt.firstChild.nodeValue : "";
    var next = live ? (viaFallbackFresh && st !== "connected" ? "CANLI (YEDEK)" : "CANLI")
      : (st !== "connected" ? "BAĞLANTI YOK" : "BEKLEMEDE");
    if (label !== next) {
      if (txt.firstChild) { txt.firstChild.nodeValue = next; }
      else { txt.appendChild(document.createTextNode(next)); }
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* Urun ikonunu ada gore secer (SUNUM amacli; ASCII-guvenli eslesme,
   * Turkce karakter dusuk harfe cevrilse de parca eslesmesi kullanilir). */
  function icoSvg(inner) {
    return '<svg class="p-ico" viewBox="0 0 24 24" fill="none" stroke="#D4AF62"' +
      ' stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
  }
  function iconFor(name) {
    var n;
    try { n = String(name || "").toLowerCase(); } catch (e) { n = ""; }
    if (n.indexOf("bilezik") > -1 || n.indexOf("alyans") > -1 || n.indexOf("yzk") > -1 ||
        n.indexOf("yuz") > -1 || n.indexOf("kolye") > -1) {
      return icoSvg('<circle cx="12" cy="14" r="6"/><path d="M9 8l1-3h4l1 3"/>');
    }
    if (n.indexOf("gram") > -1 || n.indexOf("has") > -1 || n.indexOf("bar") > -1 ||
        n.indexOf("24") > -1) {
      return icoSvg('<rect x="3" y="9" width="18" height="7" rx="1"/><line x1="8" y1="9" x2="8" y2="16"/><line x1="13" y1="9" x2="13" y2="16"/><line x1="18" y1="9" x2="18" y2="16"/>');
    }
    if (n.indexOf("ons") > -1) {
      return icoSvg('<circle cx="12" cy="12" r="8"/><path d="M4 12h16"/><path d="M12 4c3 4.5 3 11.5 0 16M12 4c-3 4.5-3 11.5 0 16"/>');
    }
    /* varsayilan: madeni para (ceyrek / yarim / cumhuriyet / lira vb.) */
    return icoSvg('<circle cx="12" cy="12" r="8"/><path d="M12 8.5v7"/><path d="M9.8 10.5h3.4a1.6 1.6 0 0 1 0 3.2h-2.4a1.6 1.6 0 0 0 0 3.2h3.4"/>');
  }

  /* ---------- 3) REKLAM ROTASYONU ---------- */
  function startAdRotation() {
    if (adTimer) { clearInterval(adTimer); }
    function showNext() {
      try {
        var ads = [];
        var id, a;
        if (state.ads) {
          for (id in state.ads) {
            if (state.ads.hasOwnProperty(id)) {
              a = state.ads[id];
              if (a && a.active !== false) { a._id = id; ads.push(a); }
            }
          }
        }
        ads.sort(function (x, y) {
          return (typeof x.order === "number" ? x.order : 9999) -
            (typeof y.order === "number" ? y.order : 9999);
        });
        var img = byId("tv-ad-img");
        var def = byId("tv-ad-default");
        var txtEl = byId("tv-ad-text");
        if (ads.length === 0) {
          if (img) { img.style.display = "none"; }
          if (def) { def.style.display = ""; }
          if (txtEl) { txtEl.innerHTML = ""; }
          return;
        }
        var ad = ads[adIndex % ads.length];
        adIndex++;
        if (def) { def.style.display = "none"; }
        if (img) {
          if (ad.imageUrl) {
            img.onerror = function () { img.style.display = "none"; };
            img.src = ad.imageUrl;
            img.style.display = "";
          } else {
            img.style.display = "none";
          }
        }
        if (txtEl) {
          txtEl.innerHTML = (ad.title ? "<div class='ad-h'>" + escapeHtml(ad.title) + "</div>" : "") +
            (ad.description ? "<div class='ad-p'>" + escapeHtml(ad.description) + "</div>" : "");
        }
        /* Sonraki gosterim suresi */
        var secs = typeof ad.durationSec === "number" && ad.durationSec >= 3 ? ad.durationSec : 10;
        if (adTimer) { clearInterval(adTimer); }
        adTimer = setInterval(showNext, secs * 1000);
      } catch (e) {}
    }
    showNext();
  }

  /* ---------- 4) VERI ABONELIKLERI (REST POLL - SDK cokmesine dayanikli) ----------
   * Okumalar AppDb.poll (Firebase REST ".json") ile yapilir; boylece v8 compat
   * SDK'sinin bazi tarayicilardaki cok-alanli snapshot cökmesi (isEmpty) ekranı
   * bos birakamaz. Firebase birincil kaynak; canli fiyat icin Harem socket
   * yedegi (asagida) marketPrices'i tazeler. marketPrices tazelik korumasiyla
   * guncellenir: daha ESKI bir deger daha CANLI olanin uzerine yazilmaz. */
  function subscribeAll() {
    var pollMs = 15000;
    AppDb.poll("settings", function (v) { state.settings = v || {}; renderAll(); }, pollMs);
    AppDb.poll("products", function (v) { state.products = v || {}; renderAll(); }, pollMs);
    AppDb.poll("currencyAdjustments", function (v) { state.adjustments = v || {}; renderCurrencies(); renderTheme2(); }, pollMs);
    AppDb.poll("advertisements", function (v) { state.ads = v || {}; startAdRotation(); }, pollMs);
    AppDb.poll("connectionStatus", function (v) { state.status = v || {}; renderLiveDot(); renderTheme2(); }, pollMs);
    AppDb.poll("branding", function (v) {
      state.branding = v || {};
      var logo = byId("tv-logo"), brand = byId("tv-brand-name");
      if (logo && v && v.logoUrl) { logo.style.display = ""; logo.src = v.logoUrl; }
      if (brand && v && v.name && brand.firstChild) { brand.firstChild.nodeValue = v.name; }
      renderTheme2();
    }, pollMs);
    AppDb.poll("marketPrices", function (v) {
      if (!v) { return; }
      var cur = state.market && state.market.updatedAt ? state.market.updatedAt : 0;
      var inc = v.updatedAt ? v.updatedAt : 0;
      if (inc >= cur) {
        state.market = v;
        try { AppDb.cacheMarket(v); } catch (e) {}
      }
      renderAll();
    }, pollMs);
    /* Canlilik gostergesi 15 sn'de bir tazeligi yeniden kontrol etsin */
    setInterval(function () { try { renderLiveDot(); renderUpdated(); renderTheme2(); } catch (e) {} }, 15000);
  }

  /* ---------- 5) ONBELLEKLE ACILIS (SDK/internet yoksa bile içerik) ---------- */
  function renderFromCache() {
    try {
      var cached = AppDb.readMarketCache();
      if (cached && !state.market) {
        state.market = cached;
        renderAll();
        var bar = byId("tv-stale-bar");
        if (bar) { bar.style.display = "block"; }
      }
    } catch (e) {}
  }

  /* ---------- 6) HAREM DOGRUDAN YEDEK (config.allowBrowserFallback=true ise) ----------
   * Bulut toplama hizmeti uzun sure veri getirmezse TV, kullanicinin
   * dogruladigi yontemle (socket.io 4.4.1, websocket transport) dogrudan
   * Harem'e baglanir. Bu ver YALNIZCA ekranda gosterilir; Firebase'e
   * yazilMAZ (TV'nin yazma izni yoktur ve olmamalidir). */
  var fbAppliedAt = 0;
  function loadScript(src, onOk) {
    try {
      var sc = document.createElement("script");
      sc.src = src;
      sc.onload = onOk || null;
      sc.onerror = function () {};
      var head = document.head || document.getElementsByTagName("head")[0];
      if (head) { head.appendChild(sc); }
    } catch (e) {}
  }
  function applyFallbackPayload(res) {
    try {
      if (!res || !res.data) { return; }
      var MAPF = {
        ALTIN: ["hasBuy", "hasSell"],
        USDTRY: ["usdBuy", "usdSell"],
        EURTRY: ["eurBuy", "eurSell"]
      };
      var out = {}, sym, rec, b, s;
      for (sym in MAPF) {
        if (!MAPF.hasOwnProperty(sym)) { continue; }
        rec = res.data[sym];
        if (!rec || typeof rec !== "object") { continue; }
        b = PriceValidator.toNumber(rec.alis);
        s = PriceValidator.toNumber(rec.satis);
        if (isFinite(b) && b > 0) { out[MAPF[sym][0]] = b; }
        if (isFinite(s) && s > 0) { out[MAPF[sym][1]] = s; }
        if (rec.dir && typeof rec.dir === "object") {
          if (rec.dir.alis_dir === "up" || rec.dir.alis_dir === "down") {
            out[MAPF[sym][0] + "Dir"] = rec.dir.alis_dir;
          }
          if (rec.dir.satis_dir === "up" || rec.dir.satis_dir === "down") {
            out[MAPF[sym][1] + "Dir"] = rec.dir.satis_dir;
          }
        }
      }
      if (!out.hasBuy && !out.usdBuy) { return; }
      var t = (res.meta && isFinite(Number(res.meta.time)))
        ? Number(res.meta.time) : Date.now();
      /* Bulut akisi tazeyse yedek KULLANILMAZ (tek dogru kaynak buluttur). */
      if (state.market && state.market.updatedAt && state.market.updatedAt >= t) { return; }
      var merged = {}, k;
      if (state.market) {
        for (k in state.market) {
          if (state.market.hasOwnProperty(k)) { merged[k] = state.market[k]; }
        }
      }
      for (k in out) { if (out.hasOwnProperty(k)) { merged[k] = out[k]; } }
      merged.updatedAt = t;
      merged.source = "browser-fallback";
      state.market = merged;
      fbAppliedAt = Date.now();
      try { AppDb.cacheMarket(merged); } catch (e) {}
      renderAll();
    } catch (e) {}
  }
  function maybeStartHaremFallback() {
    var cfg = window.APP_CONFIG || {};
    if (cfg.allowBrowserFallback !== true) { return; }
    loadScript("https://cdn.socket.io/4.4.1/socket.io.min.js", function () {
      try {
        if (typeof io !== "function") { return; }
        var s = io("wss://socket.haremaltin.com:443", { transports: ["websocket"] });
        s.on("price_changed", applyFallbackPayload);
      } catch (e) {}
    });
  }

  /* ---------- MAIN ---------- */
  function main() {
    startClock();
    /* Tasarim katmani: Firebase ayarlari gelmeden son bilinen/yayinlanan
     * tasarim (veya ?uiTheme onizlemesi) hemen uygulansin. */
    try { if (window.ThemeManager) { ThemeManager.init(); } } catch (e) {}
    /* Sag-alt tema butonu: her tiklamada siradaki tema (yalniz bu cihazda). */
    try {
      var tb = byId("tv-theme-toggle");
      if (tb && tb.addEventListener) {
        tb.addEventListener("click", function () { try { cycleTheme(); } catch (e) {} });
      }
    } catch (e) {}
    /* Ayarlar gelmeden de kayitli tema/buton/WhatsApp hemen gorunsun. */
    try { applyTheme(); renderThemeToggle(); renderWhatsApp(); } catch (e) {}
    /* Ekran boyutu degisince satirlari yeniden sigdir (TV sabit, masaustu/mobil degisir). */
    try {
      if (window.addEventListener) {
        window.addEventListener("resize", function () { try { fitProducts(lastProductCount); } catch (e) {} });
      }
    } catch (e) {}
    renderFromCache();
    /* Okumalar REST poll ile yapilir (SDK snapshot cokmesinden bagimsiz);
     * Firebase SDK yuklenmemis olsa bile ekran dolar. */
    try { subscribeAll(); } catch (e) {}
    /* Yedek Harem baglantisi canli fiyati besler (config bayragi aciksa;
     * SDK olmasa da calisir). */
    try { maybeStartHaremFallback(); } catch (e) {}
  }

  try {
    if (document.addEventListener) {
      document.addEventListener("DOMContentLoaded", function () { try { main(); } catch (e) {} });
    } else {
      window.onload = function () { try { main(); } catch (e) {} };
    }
  } catch (e) {}
})();
