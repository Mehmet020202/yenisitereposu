/* =====================================================================
 * ALTUG KUYUMCULUK - TASARIM 2 (Premium Yesil) arayuz bileseni (ES5)
 * =====================================================================
 * MIMARI KURALI (TALIMAT bolum 7): Bu dosya HICBIR veri baglantisi acmaz.
 * Harem socket, Firebase REST poll ve PriceEngine hesaplarinin OLDUGU
 * tek ortak state nesnesi tv.js'den render(state) ile buraya akatarilir.
 * Tasarim degisince baglanti kesilmez, yeniden baslatilmaz.
 *
 * SAHTE OZELLIK YOKTUR:
 *  - Fiyat degisim YUZDESI veri kaynaginda yok -> yuzde gosterilmez,
 *    yalnizca Harem'in gercek yon alani (up/down) ok isaretidir.
 *  - Fiyat ALARMI altyapisi yok -> zil simgesi konmaz.
 *  - CEVIRICI GERCEKTIR: masaustunde sag yan panelde, mobilde alt nav
 *    butonuyla acilan modal pencerede; listedeki GERCEL urunlere baglidir
 *    (adet x secili urunun tabloda gorunen guncel fiyati).
 *  - HESABIM karsiligi yok -> buton sahte is yapmaz, yalnizca
 *    "altyapi gerektirir" bilgisini gorur.
 *  - IBAN: isletme sahibinin verdigi gercek hesaplar (settings.ibanList
 *    yoksa asagidaki DEFAULT_IBANS gosterilir). YORUMLAR verisi yok ->
 *    referanstaki yorum butonu konmaz.
 * ===================================================================== */

var Theme2 = (function () {
  "use strict";

  var FAV_KEY = "altug_fav_products";
  /* Isletme sahibinin sagladigi IBAN'lar (TASARIM varsayilani). Firebase
   * settings.ibanList varsa O ONCELIK ALIR (admin panelinden yonetilebilir). */
  var DEFAULT_IBANS = [
    { bank: "Ziraat Bankasi", holder: "Mehmet Altuğ", iban: "TR70 0001 0003 9970 8936 7450 03" },
    { bank: "Kuveyt Turk", holder: "Mehmet Altuğ", iban: "TR46 0020 5000 0994 3255 4000 01" },
    { bank: "Albaraka", holder: "Mehmet Altuğ", iban: "TR43 0020 3000 1079 2871 0000 01" },
    { bank: "Kuveyt Turk", holder: "MEHMET ALTUG ALTUG KUYUMCULUK", iban: "TR33 0020 5000 0994 3684 4000 01" },
    { bank: "ING Bank", holder: "Mehmet Altuğ", iban: "TR25 0009 9039 8292 8300 1000 01" }
  ];
  var bound = false;
  var tab = "all";
  var query = "";
  var lastSig = "";
  var convSig = null;   /* cevirici urun listesi imzasi (yeniden uretme icin) */
  var convSelId = null; /* ceviricide secili urun id'si (renderlar arasi korunur) */

  function byId(id) { return document.getElementById(id); }

  /* Turkce normalizasyon: "BİLEZİK".toLowerCase() "bi̇lezik" (i + birlesik
   * nokta) uretir; bu kombinasyon karakteri silinmeden arama eslesmez. */
  function normTr(s) {
    try { return String(s || "").toLowerCase().replace(/[\u0300-\u036f]/g, ""); }
    catch (e) { return ""; }
  }

  function isActive() {
    return window.ThemeManager && ThemeManager.current() === "theme-2";
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function setTxt(id, txt) {
    var el = byId(id);
    if (!el) { return; }
    if (el.firstChild && el.firstChild.nodeType === 3) { el.firstChild.nodeValue = txt; }
    else { el.innerHTML = escapeHtml(txt); }
  }

  function toast(msg) {
    var el = byId("t2-toast");
    if (!el) { return; }
    el.innerHTML = escapeHtml(msg);
    el.style.display = "block";
    if (toast.timer) { clearTimeout(toast.timer); }
    toast.timer = setTimeout(function () { el.style.display = "none"; }, 3200);
  }

  /* Panoya kopyala (eski motor: execCommand; yeni motor: navigator.clipboard) */
  function copyText(text, okMsg) {
    var done = function (ok) { toast(ok ? okMsg : text); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        var pr = navigator.clipboard.writeText(text);
        if (pr && pr.then) { pr.then(function () { done(true); }, function () { done(false); }); return; }
      }
    } catch (e) {}
    try {
      var ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.left = "-9999px";
      document.body.appendChild(ta); ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      done(ok);
    } catch (e2) { done(false); }
  }

  /* ---------- FAVORILER (cihaza ozel; localStorage yeter, TALIMAT 8:
   * tasarim tercihi Firebase'de tutulur; favori bir kullanici verisidir
   * ve mevcut altyapida sunum katmaninda kalmalidir) ---------- */
  function favRead() {
    var out = {};
    try {
      var raw = (window.AppDb && AppDb.safeGet) ? AppDb.safeGet(FAV_KEY) : null;
      if (raw) { out = JSON.parse(raw) || {}; }
    } catch (e) { out = {}; }
    return out;
  }
  function favWrite(map) {
    try { if (window.AppDb && AppDb.safeSet) { AppDb.safeSet(FAV_KEY, JSON.stringify(map)); } } catch (e) {}
  }
  function favToggle(id) {
    var map = favRead();
    if (map[id]) { delete map[id]; } else { map[id] = 1; }
    favWrite(map);
  }

  /* ---------- ARAYUZ BAGLAMLARI (bir kez) ---------- */
  function bindUI() {
    if (bound) { return; }
    bound = true;
    var i, tabs = document.getElementsByClassName("t2-tab");
    for (i = 0; i < tabs.length; i++) {
      if (tabs[i].getAttribute("data-tab")) {
        tabs[i].onclick = function () {
          tab = this.getAttribute("data-tab");
          var j, all = document.getElementsByClassName("t2-tab");
          for (j = 0; j < all.length; j++) {
            all[j].className = String(all[j].className).replace(/ ?t2-tab-active/, "");
          }
          this.className += " t2-tab-active";
          renderProducts(lastState);
        };
      }
    }
    var sb = byId("t2-search-btn"), row = byId("t2-search-row"), inp = byId("t2-search-input");
    if (sb && row) {
      sb.onclick = function () {
        row.style.display = row.style.display === "none" ? "block" : "none";
        if (row.style.display === "block" && inp) { try { inp.focus(); } catch (e) {} }
      };
    }
    if (inp) {
      inp.onkeyup = function () { query = normTr(inp.value); renderProducts(lastState); };
    }
    var sh = byId("t2-share-btn");
    if (sh) { sh.onclick = sharePage; }

    /* Favori yildizi: satir ustu olay devretme (ES5, eski motor dostu) */
    var body = byId("t2-products-body");
    if (body) {
      body.onclick = function (ev) {
        var el = ev.target || window.event;
        while (el && el !== body && !(el.getAttribute && el.getAttribute("data-favpid"))) { el = el.parentNode; }
        if (!el || el === body) { return; }
        var pid = el.getAttribute("data-favpid");
        favToggle(pid);
        renderProducts(lastState);
      };
    }

    /* Alt menu */
    var navs = document.querySelectorAll ? document.querySelectorAll("#t2-bottom-nav button") : [];
    var n;
    for (n = 0; n < navs.length; n++) {
      navs[n].onclick = function () {
        var act = this.getAttribute("data-nav"), j;
        var btns = document.querySelectorAll("#t2-bottom-nav button");
        for (j = 0; j < btns.length; j++) { btns[j].className = ""; }
        this.className = "t2-nav-active";
        if (act === "gold") { try { window.scrollTo(0, 0); } catch (e) {} }
        else if (act === "contact") { openSheet("t2-contact-sheet"); }
        else if (act === "converter") { openConverter(); }
        else if (act === "account") { toast("Hesab\u0131m (kullan\u0131c\u0131 giri\u015fi) mevcut altyap\u0131da bulunmuyor \u2014 ayr\u0131 geli\u015ftirme gerektirir."); }
      };
    }

    /* Hamburger cekmece */
    var mb = byId("t2-menu-btn"), dw = byId("t2-drawer"), dc = byId("t2-drawer-close");
    if (mb && dw) { mb.onclick = function () { openDrawer(); }; }
    if (dc) { dc.onclick = function () { dw.style.display = "none"; }; }
    if (dw) { dw.onclick = function (ev) { if (ev.target === dw) { dw.style.display = "none"; } }; }
    var dcf = byId("t2-drawer-contact");
    if (dcf) { dcf.onclick = function (ev) { if (ev && ev.preventDefault) { ev.preventDefault(); } dw.style.display = "none"; openSheet("t2-contact-sheet"); }; }
    var dfv = byId("t2-drawer-fav");
    if (dfv) { dfv.onclick = function (ev) {
      if (ev && ev.preventDefault) { ev.preventDefault(); }
      dw.style.display = "none";
      tab = "fav";
      var j, all = document.getElementsByClassName("t2-tab");
      for (j = 0; j < all.length; j++) {
        all[j].className = String(all[j].className).replace(/ ?t2-tab-active/, "");
        if (all[j].getAttribute("data-tab") === "fav") { all[j].className += " t2-tab-active"; }
      }
      renderProducts(lastState);
    }; }

    /* Iletisim paneli kapatma */
    var cc = byId("t2-contact-close"), cs = byId("t2-contact-sheet");
    if (cc) { cc.onclick = function () { cs.style.display = "none"; }; }
    if (cs) { cs.onclick = function (ev) { if (ev.target === cs) { cs.style.display = "none"; } }; }

    /* IBAN paneli: pill acilir, disari/KAPAT kapanir; satira basilince kopyala */
    var ib = byId("t2-iban-btn"), is = byId("t2-iban-sheet"), ic = byId("t2-iban-close");
    if (ib && is) { ib.onclick = function () { is.style.display = "block"; }; }
    if (ic && is) { ic.onclick = function () { is.style.display = "none"; }; }
    if (is) { is.onclick = function (ev) { if (ev.target === is) { is.style.display = "none"; } }; }
    var il = byId("t2-iban-list");
    if (il) {
      il.onclick = function (ev) {
        var el = ev.target || window.event;
        while (el && el !== il && !(el.getAttribute && el.getAttribute("data-iban"))) { el = el.parentNode; }
        if (!el || el === il) { return; }
        copyText(el.getAttribute("data-iban"), "IBAN panoya kopyaland\u0131");
      };
    }

    /* Cevirici: miktar/birim degisince aninda yeniden hesapla */
    var ca = byId("t2-conv-amount"), cu = byId("t2-conv-unit");
    if (ca) { ca.onkeyup = ca.onchange = function () { renderConverter(lastState); }; }
    if (cu) { cu.onchange = function () { renderConverter(lastState); }; }
    /* Mobilde alt nav butonuyla acilan cevirici modalini KAPAT */
    var ccl = byId("t2-conv-close"), cvsb = byId("t2-sidebar");
    if (ccl) { ccl.onclick = closeConverter; }
    if (cvsb) { cvsb.onclick = function (ev) { if (ev.target === cvsb) { closeConverter(); } }; }
  }

  function openSheet(id) { var el = byId(id); if (el) { el.style.display = "block"; } }
  function openDrawer() { var el = byId("t2-drawer"); if (el) { el.style.display = "block"; } }

  /* CEVIRICI: masaustunde (#t2-sidebar) zaten sabit gorunur -> kaydir;
   * mobilde alt nav butonu modal pencereyi acar (CSS: t2-conv-open). */
  function openConverter() {
    var sb = byId("t2-sidebar");
    if (!sb) { return; }
    try { renderConverter(lastState); } catch (e) {}
    if (window.innerWidth >= 1181) {
      try { sb.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) {}
      return;
    }
    sb.className = "t2-conv-open";
    var amt = byId("t2-conv-amount");
    if (amt) { try { amt.focus(); } catch (e) {} }
  }
  function closeConverter() {
    var sb = byId("t2-sidebar");
    if (sb) { sb.className = ""; }
  }

  /* ---------- PAYLAS: tarayici API'si varsa onu, yoksa baglanti kopyala ---- */
  function sharePage() {
    var url = window.location.protocol + "//" + window.location.host +
      String(window.location.pathname || "/").replace(/\/(index|tv)\.html$/, "/tv");
    var title = "ALTU\u011e KUYUMCULUK - G\u00fcncel Alt\u0131n Fiyatlar\u0131";
    try {
      if (navigator.share) {
        var p = navigator.share({ title: title, url: url });
        if (p && p.then) { p.then(function () {}, function () {}); }
        return;
      }
    } catch (e) {}
    /* Yedek: panoya kopyala (eski motorlarda execCommand) */
    try {
      var ta = document.createElement("textarea");
      ta.value = url;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      toast(ok ? "Ba\u011flant\u0131 panoya kopyaland\u0131" : ("Ba\u011flant\u0131: " + url));
    } catch (e2) { toast("Ba\u011flant\u0131: " + url); }
  }

  /* ---------- RENDER: ORTAK STATE -> TEMA 2 DOM ---------- */
  var lastState = null;

  function render(state) {
    if (!isActive()) { return; } /* gizli tasarima is yok (bolum 12) */
    lastState = state;
    try { bindUI(); } catch (e) {}
    try { renderBrand(state); } catch (e) {}
    try { renderTicker(state); } catch (e) {}
    try { renderProducts(state); } catch (e) {}
    try { renderMeta(state); } catch (e) {}
    try { renderWhatsApp(state); } catch (e) {}
    try { renderIban(state); } catch (e) {}
    try { renderConverter(state); } catch (e) {}
    try { renderLive(state); } catch (e) {}
  }

  function renderBrand(state) {
    var b = state.branding || {};
    var nameEl = byId("t2-brand-name"), logo = byId("t2-logo");
    if (nameEl && b.name && nameEl.firstChild) { nameEl.firstChild.nodeValue = b.name; }
    if (logo) {
      if (b.logoUrl) { logo.src = b.logoUrl; logo.style.display = "block"; }
      else { logo.style.display = "none"; }
    }
  }

  function dirMark(dir) {
    return dir === "up" ? " \u25B2" : dir === "down" ? " \u25BC" : "";
  }

  function renderTicker(state) {
    var s = state.settings || {}, m = state.market;
    var usdBox = byId("t2-usd"), eurBox = byId("t2-eur"), onsBox = byId("t2-ons");
    var hideAll = s.currencySectionHidden === true;
    if (usdBox) { usdBox.style.display = (!hideAll && s.showUsd !== false) ? "" : "none"; }
    if (eurBox) { eurBox.style.display = (!hideAll && s.showEur !== false) ? "" : "none"; }
    if (!m) { return; }
    var usd = window.PriceEngine ? PriceEngine.calcUsd(m, state.adjustments || {}) : { buy: null, sell: null };
    var eur = window.PriceEngine ? PriceEngine.calcEur(m, state.adjustments || {}) : { buy: null, sell: null };
    fillCur("t2-usd", usd, m.usdBuyDir, m.usdSellDir, s.usdShowMode || "both");
    fillCur("t2-eur", eur, m.eurBuyDir, m.eurSellDir, s.eurShowMode || "both");
    /* ONS ($): referans sitesindeki gibi ONKONS dünya fiyati DOLAR cinsinden.
     * ons = (gram x 31.1034768) / USD-TRY. Motor HESAPLAR (uydurma degil). */
    var ons = window.PriceEngine ? PriceEngine.calcOns(m, state.adjustments || {}) : { buy: null, sell: null };
    fillCur("t2-ons", ons, m.hasBuyDir, m.hasSellDir, "both", "usd");
  }

  function fillCur(boxId, res, buyDir, sellDir, mode, fmt) {
    var box = byId(boxId);
    if (!box) { return; }
    var fmtn = (fmt === "usd") ? PriceFormatter.formatUSD : PriceFormatter.formatCurrencyTL;
    var buyEl = byId(boxId + "-buy"), sellEl = byId(boxId + "-sell");
    var rows = box.getElementsByTagName("div"), i;
    for (i = 0; i < rows.length; i++) {
      var isBuyRow = rows[i].getAttribute("class") && String(rows[i].className).indexOf("t2-cur-row") > -1;
      if (!isBuyRow) { continue; }
      var buy = rows[i].getAttribute("data-row") === "buy";
      /* data-row isaretlemesi ilk renderda eklenir */
      if (!rows[i].getAttribute("data-row")) {
        var hasBuySpan = rows[i].querySelector ? rows[i].querySelector(".t2-cur-buy") : null;
        rows[i].setAttribute("data-row", hasBuySpan ? "buy" : "sell");
        buy = hasBuySpan ? "buy" : "sell";
      }
      rows[i].style.display = buy ? (mode !== "sell" ? "" : "none") : (mode !== "buy" ? "" : "none");
    }
    if (buyEl) {
      buyEl.innerHTML = res.buy !== null ?
        escapeHtml(fmtn(res.buy)) + dirMark(buyDir) : "-";
    }
    if (sellEl) {
      sellEl.innerHTML = res.sell !== null ?
        escapeHtml(fmtn(res.sell)) + dirMark(sellDir) : "-";
    }
  }

  function activeList(state) {
    var list = [], id, p;
    if (!state.products) { return null; }
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
    return list;
  }

  function renderProducts(state) {
    var body = byId("t2-products-body");
    if (!body || !state) { return; }
    var list = activeList(state);
    if (!list || !state.market) { return; }
    var s = state.settings || {};
    var displayMode = s.goldDisplayMode || "both";
    var showBuy = displayMode !== "sell";
    var showSell = displayMode !== "buy";
    var hb = byId("t2-th-buy"), hs = byId("t2-th-sell");
    if (hb) { hb.style.display = showBuy ? "" : "none"; }
    if (hs) { hs.style.display = showSell ? "" : "none"; }

    var favs = favRead(), favCount = 0, k;
    for (k in favs) { if (favs.hasOwnProperty(k)) { favCount++; } }
    setTxt("t2-fav-count", String(favCount));

    /* Ortak HAS referansinin gercek yonu (Harem dir alani); yuzde VERI
     * KAYNAGINDA YOK -> sahte % gosterilmez (TALIMAT bolum 6.D). */
    var dirField = s.goldReference === "has_sell" ? "hasSellDir" : "hasBuyDir";
    var refDir = state.market ? state.market[dirField] : null;
    var dirHtml = refDir === "up"
      ? '<span class="t2-pdir t2-pdir-up">\u25B2</span>'
      : refDir === "down"
      ? '<span class="t2-pdir t2-pdir-down">\u25BC</span>'
      : "";

    var html = "", i, p, calc, name, buyTxt, sellTxt, star, visible;
    var shown = 0;
    for (i = 0; i < list.length; i++) {
      p = list[i];
      name = p.name || p._id;
      visible = true;
      if (tab === "fav" && !favs[p._id]) { visible = false; }
      if (query && normTr(name).indexOf(query) === -1) { visible = false; }
      if (!visible) { continue; }
      shown++;
      calc = PriceEngine.calcProduct(p, state.market, state.settings);
      buyTxt = calc && calc.buy !== null ? PriceFormatter.formatTL(calc.buy) : "-";
      sellTxt = calc && calc.sell !== null ? PriceFormatter.formatTL(calc.sell) : "-";
      star = favs[p._id]
        ? '<button type="button" class="t2-fav-btn t2-fav-on" data-favpid="' + escapeHtml(p._id) + '" title="Favorilerden \u00e7\u0131kar">\u2605</button>'
        : '<button type="button" class="t2-fav-btn" data-favpid="' + escapeHtml(p._id) + '" title="Favorilere ekle">\u2606</button>';
      html += '<div class="t2-prow">' +
        '<span class="t2-pname">' + escapeHtml(name) + '</span>' + star +
        '<span class="t2-pbuy"' + (showBuy ? "" : ' style="display:none"') + '>' + buyTxt + '</span>' +
        '<span class="t2-psell"' + (showSell ? "" : ' style="display:none"') + '><span class="t2-psell-val">' + sellTxt + '</span>' + dirHtml + '</span>' +
        '</div>';
    }
    if (shown === 0) {
      html = '<div class="t2-empty">' + (tab === "fav"
        ? "Henüz favori ürün seçmediniz. Satırlardaki yıldıza dokunun."
        : (query ? "Aramaya uygun ürün bulunamadı." : "Ürün listesi bekleniyor...")) + '</div>';
    }
    body.innerHTML = html;
  }

  function renderMeta(state) {
    var m = state.market, s = state.settings || {};
    setTxt("t2-updated", m && m.updatedAt ? PriceFormatter.formatDateTime(m.updatedAt) : "-");
    var stale = true;
    if (m) {
      stale = !PriceFormatter.freshnessInfo(m.updatedAt, Date.now(),
        (window.APP_CONFIG && window.APP_CONFIG.staleLimitMs) || 180000).fresh;
    }
    var bar = byId("t2-stale-bar");
    if (bar) { bar.style.display = stale && m ? "block" : "none"; }
    var note = byId("t2-note");
    if (note) { note.innerHTML = escapeHtml(s.tvNote || ""); }
  }

  function renderWhatsApp(state) {
    var s = state.settings || {};
    var num = String(s.whatsappNumber || "").replace(/[^0-9]/g, "");
    if (!num) { num = "905432405202"; } /* Tasarim 1 ile ayni magaza numarasi */
    var msg = s.whatsappMessage || "Merhaba, güncel altın fiyatları hakkında bilgi almak istiyorum.";
    var href = "https://wa.me/" + num + "?text=" + encodeURIComponent(msg);
    var floatBtn = byId("t2-whatsapp"), sheetLink = byId("t2-wa-link");
    var enabled = s.whatsappEnabled !== false;
    if (floatBtn) {
      floatBtn.href = href;
      floatBtn.style.display = enabled ? "block" : "none";
    }
    if (sheetLink) {
      sheetLink.href = href;
      sheetLink.style.display = enabled ? "block" : "none";
    }
  }

  function ibanData(state) {
    var s = (state && state.settings) || {};
    var list = s.ibanList;
    /* Firebase'te (admin panelinden girilmis) liste varsa o gecerli; yoksa
     * isletme sahibinin verdigi varsayilan liste gosterilir. */
    if (list && list.length) { return list; }
    return DEFAULT_IBANS;
  }

  function renderIban(state) {
    var box = byId("t2-iban-list");
    if (!box) { return; }
    var list = ibanData(state), html = "", i, it, iban, any = 0;
    for (i = 0; i < list.length; i++) {
      it = list[i] || {};
      iban = String(it.iban || "");
      if (!iban) { continue; }
      any++;
      html += '<div class="t2-iban-row" data-iban="' + escapeHtml(iban.replace(/\s+/g, "")) + '">' +
        '<div class="t2-iban-bank">' + escapeHtml(it.bank || "") + '</div>' +
        (it.holder ? '<div class="t2-iban-holder">Hesap sahibi: ' + escapeHtml(it.holder) + '</div>' : '') +
        '<div class="t2-iban-no">' + escapeHtml(iban) + '</div>' +
        '<div class="t2-iban-copy">Kopyalamak icin dokunun</div>' +
        '</div>';
    }
    if (!any) { html = '<div class="t2-iban-holder">Henuz IBAN bilgisi girilmemis.</div>'; }
    box.innerHTML = html;
  }

  function parseNum(s) {
    s = String(s == null ? "" : s).replace(/\s/g, "");
    if (s.indexOf(",") > -1) { s = s.replace(/\./g, "").replace(",", "."); }
    var n = parseFloat(s);
    return isFinite(n) ? n : NaN;
  }

  /* GERCEK cevirici: listedeki GERCEL urunlere baglidir. Acilir liste,
   * tabloyla ayni aktif/TV'de gorunur urunlerden olusur. Sonuc =
   * adet x secili urunun tabloda gorunen guncel alis/satis fiyati
   * (PriceEngine.calcProduct) -> hammadde gram hesab degil, tam tablo fiyati. */
  function renderConverter(state) {
    var box = byId("t2-conv-result"), unitEl = byId("t2-conv-unit");
    if (!box || !unitEl) { return; }
    var list = (state && activeList(state)) || [];
    var amtEl = byId("t2-conv-amount");
    var amt = parseNum(amtEl ? amtEl.value : "1");
    if (!(amt > 0)) { amt = 0; }

    /* Urun kumesi degistiyse secenekleri yeniden uret (her poll'da degil). */
    var sig = "", i;
    for (i = 0; i < list.length; i++) { sig += String(list[i]._id) + "|"; }
    if (sig !== convSig) {
      convSig = sig;
      var opts = "";
      for (i = 0; i < list.length; i++) {
        opts += '<option value="' + escapeHtml(list[i]._id) + '">'
          + escapeHtml(list[i].name || list[i]._id) + '</option>';
      }
      unitEl.innerHTML = opts || '<option value="">Urun bulunamadi</option>';
    }

    /* Onceki secimi koru; degistiyse convSelId'yi guncelle. */
    if (convSelId) {
      for (i = 0; i < unitEl.options.length; i++) {
        if (unitEl.options[i].value === convSelId) { unitEl.selectedIndex = i; break; }
      }
    }
    convSelId = unitEl.value;

    var p = null;
    for (i = 0; i < list.length; i++) { if (list[i]._id === convSelId) { p = list[i]; break; } }
    if (!p || !state || !state.market) {
      box.innerHTML = '<div class="t2-conv-hint">Canl\u0131 fiyat bekleniyor\u2026</div>';
      return;
    }
    var calc = PriceEngine.calcProduct(p, state.market, state.settings);
    var buy = calc && calc.buy !== null ? calc.buy * amt : null;
    var sell = calc && calc.sell !== null ? calc.sell * amt : null;
    var name = p.name || p._id;
    var amtTxt = (amt % 1 === 0) ? String(amt) : String(amt).replace(".", ",");
    box.innerHTML =
      '<div class="t2-conv-line"><span class="t2-conv-k">' + escapeHtml(amtTxt + " x " + name) + ' \u00b7 Al\u0131\u015f</span><span class="t2-conv-v-buy">' + escapeHtml(buy !== null ? PriceFormatter.formatTL(buy) : "-") + '</span></div>' +
      '<div class="t2-conv-line"><span class="t2-conv-k">' + escapeHtml(amtTxt + " x " + name) + ' \u00b7 Sat\u0131\u015f</span><span class="t2-conv-v-sell">' + escapeHtml(sell !== null ? PriceFormatter.formatTL(sell) : "-") + '</span></div>';
  }

  function renderLive(state) {
    var dot = byId("t2-live-dot"), txt = byId("t2-live-text");
    if (!dot || !txt) { return; }
    var st = state.status && state.status.harem ? state.status.harem : "unknown";
    var fresh = state.market && PriceFormatter.freshnessInfo(
      state.market.updatedAt, Date.now(),
      (window.APP_CONFIG && window.APP_CONFIG.staleLimitMs) || 180000).fresh;
    var cls = "t2-dot", label;
    if (fresh && st === "connected") { cls += " t2-dot-green"; label = "CANLI"; }
    else if (fresh) { cls += " t2-dot-amber"; label = "CANLI"; }
    else if (st !== "connected") { cls += " t2-dot-red"; label = "BA\u011eLANTI YOK"; }
    else { cls += " t2-dot-amber"; label = "BEKLEMEDE"; }
    dot.className = cls;
    setTxt("t2-live-text", label);
  }

  return { render: render, toast: toast };
})();
