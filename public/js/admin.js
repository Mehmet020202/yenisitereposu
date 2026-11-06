/* =====================================================================
 * ALTUĞ KUYUMCULUK - Yonetim Paneli Makine Kodu (ES5)
 * =====================================================================
 * Her degisiklik Firebase'e yazilir; TV sayfasi abonelikler sayesinde
 * sayfa yenilenmeden aninda guncellenir.
 * ===================================================================== */

(function () {
  "use strict";

  var state = {
    me: null,
    market: {},
    settings: {},
    products: {},
    adjustments: {},
    ads: {},
    status: {},
    branding: {},
    rootAdminUid: null,
    logs: {}
  };

  var INITIAL_PRODUCTS = [
    ["HAS ALTIN", 1.00, 1.02],
    ["Gram Altın", 1.00, 1.05],
    ["22 Ayar", 0.90, 0.94],
    ["18 Ayar", 0.74, 0.78],
    ["14 Ayar", 0.56, 0.62],
    ["Çeyrek Altın", 6.42, 6.60],
    ["Yarım Altın", 12.84, 13.20],
    ["Tam Altın", 6.36 * 4, 6.50 * 4],
    ["Ata Altın", 6.60 * 4, 6.90 * 4],
    ["Gremse Altın", 6.36 * 5, 6.50 * 5],
    ["22 Ayar Bilezik", 0.88, 0.92]
  ];

  function byId(id) { return document.getElementById(id); }
  function escapeHtml(s) {
    return String(s === null || typeof s === "undefined" ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function toast(msg) {
    var t = byId("toast");
    if (!t) { return; }
    t.innerHTML = escapeHtml(msg);
    t.style.display = "block";
    setTimeout(function () { t.style.display = "none"; }, 2500);
  }

  /* Islem gecmisine kayit */
  function logOp(action, detail) {
    try {
      AppDb.push("operationLogs", {
        by: state.me ? state.me.uid : "?",
        action: action,
        detail: detail || "",
        at: Date.now()
      });
    } catch (e) {}
  }

  /* ---------- GIRIS KONTROLU ---------- */
  function requireAuth(onReady) {
    try {
      AppDb.init();
    } catch (e) {
      byId("admin-content").innerHTML =
        "<div class='section'><h2>Kurulum gerekli</h2><p>" + escapeHtml(e.message) +
        "</p><p class='muted'>config.js icindeki databaseURL alanini doldurun.</p></div>";
      return;
    }
    /* v8 compat'ta kök ref üzerinde getAuth()/on("auth") YOKTUR;
     * AppDb.currentUser + auth.onAuthStateChanged kullanilir.
     * (Eski 2.x yedeginde db.getAuth() zaten calisir — iki SDK'da dogru.) */
    function onAuth(authData) {
      if (!authData) {
        window.location.href = "login.html";
        return;
      }
      state.me = authData;
      var u = byId("topbar-user");
      if (u) { u.innerHTML = escapeHtml(authData.password ? authData.password.email : "yonetici"); }
      onReady();
    }
    var current = null;
    try { current = AppDb.currentUser(); } catch (e) {}
    if (current) { onAuth(current); return; }
    /* Synchron hazir degilse (compat oturum acilisi): dinleyici ilk olayda cagrir. */
    AppDb.onAuthChange(function (a) { onAuth(a); });
  }

  /* ---------- ABONELIKLER ---------- */
  function subscribeAll() {
    AppDb.subscribe("marketPrices", function (v) {
      /* Tazelik korumasi: REST poll'un BAYAT degeri, canli Harem yedeginin
       * uzerine yazilmaz (updatedAt karsilastirmasi). */
      if (v) {
        var cur = state.market && state.market.updatedAt ? state.market.updatedAt : 0;
        var inc = v.updatedAt ? v.updatedAt : 0;
        if (inc >= cur) { state.market = v; }
      }
      renderMarket(); renderOverview(); renderHasPreview(); renderCurPreviews();
    });
    AppDb.subscribe("settings", function (v) { state.settings = v || {}; syncSettingsUi(); try { renderThemesSection(); } catch (e) {} });
    AppDb.subscribe("products", function (v) { state.products = v || {}; renderProducts(); renderOverview(); renderHasPreview(); });
    AppDb.subscribe("currencyAdjustments", function (v) { state.adjustments = v || {}; syncAdjustUi(); renderCurPreviews(); });
    AppDb.subscribe("advertisements", function (v) { state.ads = v || {}; renderAds(); renderOverview(); });
    AppDb.subscribe("connectionStatus", function (v) { state.status = v || {}; renderConn(); renderOverview(); });
    AppDb.subscribe("branding", function (v) { state.branding = v || {}; syncBrandingUi(); });
    AppDb.subscribe("admins/rootAdminUid", function (v) {
      state.rootAdminUid = v;
      var el = byId("admin-uid-current");
      if (el) { el.innerHTML = v ? escapeHtml(v) : "ATANMAMIS"; }
      var inp = byId("admin-uid-input");
      if (inp && v && !inp.value) { inp.value = v; }
    });
    AppDb.subscribe("operationLogs", function (v) { state.logs = v || {}; renderLogs(); });
  }

  /* ---------- CANLI HAREM YEDEGI (tarayici dogrudan socket) ----------
   * Firebase marketPrices bayat oldugunda (bulut ingestion calismiyor) admin
   * de TV gibi dogrudan Harem socket'e baglanip CANLI fiyati gosterir.
   * YALNIZ ekranda; Firebase'e yazilmaz. config.allowBrowserFallback=true iken. */
  function loadScriptAdmin(src, onOk) {
    try {
      var sc = document.createElement("script");
      sc.src = src; sc.onload = onOk || null; sc.onerror = function () {};
      var head = document.head || document.getElementsByTagName("head")[0];
      if (head) { head.appendChild(sc); }
    } catch (e) {}
  }
  function applyHaremPayload(res) {
    try {
      if (!res || !res.data) { return; }
      var MAPF = { ALTIN: ["hasBuy", "hasSell"], USDTRY: ["usdBuy", "usdSell"], EURTRY: ["eurBuy", "eurSell"] };
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
          if (rec.dir.alis_dir === "up" || rec.dir.alis_dir === "down") { out[MAPF[sym][0] + "Dir"] = rec.dir.alis_dir; }
          if (rec.dir.satis_dir === "up" || rec.dir.satis_dir === "down") { out[MAPF[sym][1] + "Dir"] = rec.dir.satis_dir; }
        }
      }
      if (!out.hasBuy && !out.usdBuy) { return; }
      var t = (res.meta && isFinite(Number(res.meta.time))) ? Number(res.meta.time) : Date.now();
      if (state.market && state.market.updatedAt && state.market.updatedAt >= t) { return; }
      var merged = {}, k;
      if (state.market) { for (k in state.market) { if (state.market.hasOwnProperty(k)) { merged[k] = state.market[k]; } } }
      for (k in out) { if (out.hasOwnProperty(k)) { merged[k] = out[k]; } }
      merged.updatedAt = t; merged.source = "browser-fallback";
      state.market = merged;
      renderMarket(); renderOverview(); renderHasPreview(); renderCurPreviews();
    } catch (e) {}
  }
  function maybeStartHaremFallback() {
    var cfg = window.APP_CONFIG || {};
    if (cfg.allowBrowserFallback !== true) { return; }
    loadScriptAdmin("https://cdn.socket.io/4.4.1/socket.io.min.js", function () {
      try {
        if (typeof io !== "function") { return; }
        var s = io("wss://socket.haremaltin.com:443", { transports: ["websocket"] });
        s.on("price_changed", applyHaremPayload);
      } catch (e) {}
    });
  }

  /* ---------- RENDER: GENEL BAKIS ---------- */
  function renderOverview() {
    var box = byId("ov-cards");
    if (!box) { return; }
    var st = state.status.harem || "bilinmiyor";
    var fresh = PriceFormatter.freshnessInfo(state.market.updatedAt, Date.now(),
      (window.APP_CONFIG && window.APP_CONFIG.staleLimitMs) || 180000);
    var activeCount = 0, k;
    for (k in state.products) {
      if (state.products.hasOwnProperty(k)) {
        if (state.products[k] && state.products[k].archived !== true && state.products[k].active !== false) { activeCount++; }
      }
    }
    var adCount = 0, a;
    for (a in state.ads) {
      if (state.ads.hasOwnProperty(a) && state.ads[a] && state.ads[a].active !== false) { adCount++; }
    }
    var cards = [
      ["Harem Baglantisi", st, st === "connected" ? "ok" : "bad"],
      ["Son Fiyat Guncellemesi", fresh.label, fresh.fresh ? "ok" : "bad"],
      ["HAS Alis / Satis", fmt(state.market.hasBuy) + " / " + fmt(state.market.hasSell), ""],
      ["USD Alis / Satis", fmt(state.market.usdBuy) + " / " + fmt(state.market.usdSell), ""],
      ["EUR Alis / Satis", fmt(state.market.eurBuy) + " / " + fmt(state.market.eurSell), ""],
      ["Aktif Urun Sayisi", String(activeCount), ""],
      ["Aktif Reklam Sayisi", String(adCount), ""],
      ["TV Fiyat Durumu", fresh.fresh ? "ANLIK GUNCEL" : "GUNCEL DEGIL", fresh.fresh ? "ok" : "warn"]
    ];
    var html = "", i;
    for (i = 0; i < cards.length; i++) {
      html += "<div class='card'><div class='card-t'>" + escapeHtml(cards[i][0]) +
        "</div><div class='card-v " + cards[i][2] + "'>" + escapeHtml(cards[i][1]) + "</div></div>";
    }
    box.innerHTML = html;
  }
  function fmt(v) { return v ? PriceFormatter.formatCurrencyTL(v) : "-"; }

  /* ---------- CANLI PIYASA ---------- */
  function renderMarket() {
    setTxt("mk-has-buy", fmt(state.market.hasBuy));
    setTxt("mk-has-sell", fmt(state.market.hasSell));
    setTxt("mk-usd-buy", fmt(state.market.usdBuy));
    setTxt("mk-usd-sell", fmt(state.market.usdSell));
    setTxt("mk-eur-buy", fmt(state.market.eurBuy));
    setTxt("mk-eur-sell", fmt(state.market.eurSell));
    setTxt("mk-updated", state.market.updatedAt ? PriceFormatter.formatDateTime(state.market.updatedAt) : "-");
    setTxt("mk-source", state.market.source || "-");
    /* musteriler ekraninda hesaplanan (ilk aktif urun bazli karsilastirma) */
    var calcTxt = "-";
    if (state.market.hasBuy) {
      var base = PriceEngine.getBasePrice(state.market, state.settings);
      calcTxt = base ? PriceFormatter.formatTL(base) + " (baz) -> urunler carpanlarla" : "-";
    }
    setTxt("mk-has-calc", calcTxt);
  }
  function setTxt(id, txt) {
    var el = byId(id);
    if (el) { el.innerHTML = escapeHtml(txt); }
  }

  /* ---------- URUN YONETIMI ---------- */
  function renderProducts() {
    var tbl = byId("products-table");
    if (!tbl) { return; }
    var head = "<tr><th>Ad</th><th>Alis &ccedil;arpani</th><th>Satis &ccedil;arpani</th>" +
      "<th>Sira</th><th>TV</th><th>&#304;slemler</th></tr>";
    var rows = "", id, p;
    var list = [];
    for (id in state.products) {
      if (state.products.hasOwnProperty(id)) {
        p = state.products[id];
        if (p) { p._id = id; list.push(p); }
      }
    }
    list.sort(function (a, b) {
      var oa = typeof a.order === "number" ? a.order : 999;
      var ob = typeof b.order === "number" ? b.order : 999;
      if (oa !== ob) { return oa - ob; }
      return String(a.name || "") < String(b.name || "") ? -1 : 1;
    });
    var i;
    for (i = 0; i < list.length; i++) {
      p = list[i];
      rows += "<tr>" +
        "<td>" + escapeHtml(p.name) + "</td>" +
        "<td>" + escapeHtml(String(p.buyMultiplier)) + "</td>" +
        "<td>" + escapeHtml(String(p.sellMultiplier)) + "</td>" +
        "<td>" + (typeof p.order === "number" ? p.order : "-") +
        " <button class='btn-x' data-act='up' data-pid='" + escapeHtml(p._id) + "'>&uarr;</button>" +
        "<button class='btn-x' data-act='down' data-pid='" + escapeHtml(p._id) + "'>&darr;</button></td>" +
        "<td><button class='btn-x' data-act='tvtoggle' data-pid='" + escapeHtml(p._id) + "'>" +
        (p.tvVisible === false ? "GÖSTER" : "GİZLE") + "</button></td>" +
        "<td>" +
        "<button class='btn-x' data-act='edit' data-pid='" + escapeHtml(p._id) + "'>DÜZENLE</button>" +
        "<button class='btn-x btn-danger' data-act='delete' data-pid='" + escapeHtml(p._id) + "'>SİL</button>" +
        "</td></tr>";
    }
    tbl.innerHTML = head + (rows || "<tr><td colspan='6' class='muted'>Urun yok. Yukaridan ekleyin.</td></tr>");
    tbl.onclick = handleProductButtons;
  }

  /* ---------- URUN DUZENLEME MODALI ---------- */
  var editingPid = null;
  function openEdit(pid) {
    var p = state.products[pid];
    if (!p) { return; }
    editingPid = pid;
    var nm = byId("edit-name"), bb = byId("edit-buy"), ss = byId("edit-sell"), er = byId("edit-error");
    if (nm) { nm.value = p.name || ""; }
    if (bb) { bb.value = (typeof p.buyMultiplier === "number") ? String(p.buyMultiplier) : ""; }
    if (ss) { ss.value = (typeof p.sellMultiplier === "number") ? String(p.sellMultiplier) : ""; }
    if (er) { er.innerHTML = ""; }
    var m = byId("edit-modal");
    if (m) { m.style.display = "flex"; }
    if (nm) { try { nm.focus(); } catch (e) {} }
  }
  function closeEdit() {
    editingPid = null;
    var m = byId("edit-modal");
    if (m) { m.style.display = "none"; }
  }
  function saveEdit() {
    if (!editingPid) { return; }
    var nm = byId("edit-name"), bb = byId("edit-buy"), ss = byId("edit-sell"), er = byId("edit-error");
    var name = nm ? nm.value : "";
    var buy = PriceValidator.toNumber(bb ? bb.value : "");
    var sell = PriceValidator.toNumber(ss ? ss.value : "");
    if (!name || name.length > 60) { if (er) { er.innerHTML = "Ürün adı geçersiz (1-60 karakter)."; } return; }
    if (!isFinite(buy) || buy <= 0 || buy >= 1000) { if (er) { er.innerHTML = "Alış çarpanı geçersiz (0-1000 arası)."; } return; }
    if (!isFinite(sell) || sell <= 0 || sell >= 1000) { if (er) { er.innerHTML = "Satış çarpanı geçersiz (0-1000 arası)."; } return; }
    var patch = { name: name, buyMultiplier: buy, sellMultiplier: sell, updatedAt: Date.now() };
    var pid = editingPid;
    AppDb.update("products/" + pid, patch, function (err) {
      if (err) { if (er) { er.innerHTML = "Kaydedilemedi: " + (err.message || err); } return; }
      if (state.products[pid]) {
        state.products[pid].name = name;
        state.products[pid].buyMultiplier = buy;
        state.products[pid].sellMultiplier = sell;
      }
      renderProducts(); renderOverview(); renderHasPreview(); renderCurPreviews();
      logOp("urun.duzenle", name);
      toast("Ürün güncellendi");
      closeEdit();
    });
  }

  function handleProductButtons(ev) {
    var el = ev.target;
    while (el && el !== this && !(el.getAttribute && el.getAttribute("data-act"))) {
      el = el.parentNode;
    }
    if (!el || el === this) { return; }
    var act = el.getAttribute("data-act");
    var pid = el.getAttribute("data-pid");
    var p = state.products[pid];
    if (!p) { return; }

    if (act === "edit") {
      openEdit(pid);
    } else if (act === "tvtoggle") {
      var nv = p.tvVisible === false ? true : false;
      AppDb.update("products/" + pid, { tvVisible: nv }, function () {
        p.tvVisible = nv; renderProducts();
      });
      logOp("urun.tv", p.name + " -> tvVisible=" + nv);
    } else if (act === "delete") {
      if (window.confirm("'" + p.name + "' silinsin mi? Bu işlem geri alınamaz!")) {
        AppDb.remove("products/" + pid, function (err) {
          if (err) { toast("Silinemedi: " + (err.message || err)); return; }
          if (state.products.hasOwnProperty(pid)) { delete state.products[pid]; } else { state.products[pid] = null; }
          renderProducts(); renderOverview(); renderHasPreview();
          logOp("urun.sil", p.name);
          toast("Ürün silindi");
        });
      }
    } else if (act === "up" || act === "down") {
      moveProduct(pid, act === "up" ? -1 : 1);
    }
  }

  /* Satir icindeki input degerlerini urene yazar (KAYDET dugmesi) */
  function saveProductFromInputs(pid) {
    var inputs = document.getElementsByTagName("input");
    var patch = {};
    var i, el;
    for (i = 0; i < inputs.length; i++) {
      el = inputs[i];
      if (el.getAttribute && el.getAttribute("data-pid") === pid) {
        var f = el.getAttribute("data-pf");
        var v = el.value;
        if (f === "buyMultiplier" || f === "sellMultiplier") {
          var num = PriceValidator.toNumber(v);
          if (!isFinite(num) || num <= 0 || num >= 1000) {
            toast("Gecersiz carpan: " + v);
            return;
          }
          patch[f] = num;
        } else if (f === "name") {
          if (!v || v.length > 60) { toast("Gecersiz urun adi"); return; }
          patch.name = v;
        }
      }
    }
    if (state.products[pid]) { patch.updatedAt = Date.now(); }
    AppDb.update("products/" + pid, patch);
    logOp("urun.duzenle", state.products[pid] ? state.products[pid].name : pid);
    toast("Urun kaydedildi - TV'ye aninda yansidi");
  }

  function moveProduct(pid, dir) {
    var list = [], i, p;
    for (i in state.products) {
      if (state.products.hasOwnProperty(i)) {
        p = state.products[i];
        if (p) { p._id = i; list.push(p); }
      }
    }
    list.sort(function (a, b) {
      var oa = typeof a.order === "number" ? a.order : 999;
      var ob = typeof b.order === "number" ? b.order : 999;
      if (oa !== ob) { return oa - ob; }
      return String(a.name || "") < String(b.name || "") ? -1 : 1;
    });
    var idx = -1;
    for (i = 0; i < list.length; i++) { if (list[i]._id === pid) { idx = i; break; } }
    var target = idx + dir;
    if (idx < 0 || target < 0 || target >= list.length) { return; }
    /* Komşuyla yer değiştir, sonra SIRANIN TAMAMINI 1..n yeniden numaralandir.
     * Eşit/eksik 'order' degerlerinde takasin islememesi sorununu kökten çözer. */
    var tmp = list[idx]; list[idx] = list[target]; list[target] = tmp;
    var changed = [];
    for (i = 0; i < list.length; i++) {
      if (list[i].order !== (i + 1)) { list[i].order = i + 1; changed.push(list[i]); }
    }
    renderProducts();  /* iyimser: aninda goster (5sn poll beklenmez) */
    var j;
    for (j = 0; j < changed.length; j++) {
      AppDb.update("products/" + changed[j]._id, { order: changed[j].order });
    }
    logOp("urun.sira", state.products[pid] ? state.products[pid].name : pid);
  }

  function addProduct() {
    var name = byId("np-name").value;
    var buy = PriceValidator.toNumber(byId("np-buy").value);
    var sell = PriceValidator.toNumber(byId("np-sell").value);
    var img = byId("np-img").value;
    if (!name || name.length > 60) { toast("Urun adi gecersiz"); return; }
    if (!isFinite(buy) || buy <= 0 || buy >= 1000) { toast("Alis carpani gecersiz"); return; }
    if (!isFinite(sell) || sell <= 0 || sell >= 1000) { toast("Satis carpani gecersiz"); return; }
    var maxOrder = 0, k;
    for (k in state.products) {
      if (state.products.hasOwnProperty(k) && state.products[k]) {
        maxOrder = Math.max(maxOrder, state.products[k].order || 0);
      }
    }
    var rec = {
      name: name,
      buyMultiplier: buy,
      sellMultiplier: sell,
      active: true,
      tvVisible: true,
      archived: false,
      order: maxOrder + 1,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    if (img) { rec.imageUrl = img; }
    AppDb.push("products", rec);
    logOp("urun.ekle", name);
    toast("Urun eklendi - TV ekraninda gorunuyor");
    byId("np-name").value = ""; byId("np-buy").value = "";
    byId("np-sell").value = ""; byId("np-img").value = "";
  }

  /* ---------- HAS REFERANSI ---------- */
  function syncSettingsUi() {
    var gr = state.settings.goldReference || "has_buy";
    var b = byId("gr-buy"), s = byId("gr-sell");
    if (b && s) { b.checked = gr === "has_buy"; s.checked = gr === "has_sell"; }
    var gm = byId("gold-mode");
    if (gm) { gm.value = state.settings.goldDisplayMode || "both"; }
    var ch = byId("cur-section-hide");
    if (ch) { ch.checked = state.settings.currencySectionHidden === true; }
    var tn = byId("tv-note-input");
    if (tn && document.activeElement !== tn) { tn.value = state.settings.tvNote || ""; }
    var th = byId("tv-theme-select");
    if (th) { th.value = state.settings.theme || "dark"; }
    var tss = byId("theme-switch-show");
    if (tss) { tss.checked = state.settings.showThemeSwitcher !== false; }
    var we = byId("wa-enable");
    if (we) { we.checked = state.settings.whatsappEnabled !== false; }
    var wn = byId("wa-number");
    if (wn && document.activeElement !== wn) { wn.value = state.settings.whatsappNumber || "905432405202"; }
    var wm = byId("wa-message");
    if (wm && document.activeElement !== wm) { wm.value = state.settings.whatsappMessage || "Merhaba, güncel altın fiyatları hakkında bilgi almak istiyorum."; }
    var ii = byId("iban-input");
    if (ii && document.activeElement !== ii) { ii.value = ibanSerialize(state.settings.ibanList); }
  }

  function renderHasPreview() {
    var el = byId("has-preview");
    if (!el) { return; }
    if (!state.market.hasBuy) { el.innerHTML = "Henuz piyasa verisi yok."; return; }
    var base = PriceEngine.getBasePrice(state.market, state.settings);
    var html = "Baz fiyat: <b>" + PriceFormatter.formatTL(base) + "</b><br>Ornek (Tam Altin 6,36 / 6,50):<br>";
    html += "Alis: " + PriceFormatter.formatTL(base * 6.36) +
      " &middot; Satis: " + PriceFormatter.formatTL(base * 6.50);
    el.innerHTML = html;
  }

  function setGoldReference(ref) {
    AppDb.update("settings", { goldReference: ref });
    logOp("has.referans", ref);
    toast("Ortak HAS referansi degisti - tum urunler yeniden hesaplandi");
  }

  /* ---------- USD / EUR ---------- */
  function syncAdjustUi() {
    var a = state.adjustments || {};
    var m = state.settings || {};
    setVal("usd-buy-adj", a.usdBuyAdjustment);
    setVal("usd-sell-adj", a.usdSellAdjustment);
    setVal("eur-buy-adj", a.eurBuyAdjustment);
    setVal("eur-sell-adj", a.eurSellAdjustment);
    var us = byId("usd-show"); if (us) { us.checked = m.showUsd !== false; }
    var es = byId("eur-show"); if (es) { es.checked = m.showEur !== false; }
    var um = byId("usd-mode"); if (um) { um.value = m.usdShowMode || "both"; }
    var em = byId("eur-mode"); if (em) { em.value = m.eurShowMode || "both"; }
  }
  function setVal(id, v) {
    var el = byId(id);
    if (el && document.activeElement !== el) {
      el.value = (typeof v === "number") ? String(v).replace(".", ",") : "";
    }
  }

  function saveUsd() {
    var buy = PriceValidator.toNumber(byId("usd-buy-adj").value);
    var sel = PriceValidator.toNumber(byId("usd-sell-adj").value);
    if (isNaN(buy)) { buy = 0; }
    if (isNaN(sel)) { sel = 0; }
    AppDb.update("currencyAdjustments", { usdBuyAdjustment: buy, usdSellAdjustment: sel });
    AppDb.update("settings", {
      showUsd: byId("usd-show").checked,
      usdShowMode: byId("usd-mode").value
    });
    logOp("usd.ayar", buy + "/" + sel);
    toast("USD ayarlari kaydedildi");
  }
  function saveEur() {
    var buy = PriceValidator.toNumber(byId("eur-buy-adj").value);
    var sel = PriceValidator.toNumber(byId("eur-sell-adj").value);
    if (isNaN(buy)) { buy = 0; }
    if (isNaN(sel)) { sel = 0; }
    AppDb.update("currencyAdjustments", { eurBuyAdjustment: buy, eurSellAdjustment: sel });
    AppDb.update("settings", {
      showEur: byId("eur-show").checked,
      eurShowMode: byId("eur-mode").value
    });
    logOp("eur.ayar", buy + "/" + sel);
    toast("EUR ayarlari kaydedildi");
  }

  function renderCurPreviews() {
    var usd = PriceEngine.calcUsd(state.market, state.adjustments);
    var eur = PriceEngine.calcEur(state.market, state.adjustments);
    var el = byId("usd-preview");
    if (el && usd.buy !== null) {
      el.innerHTML = "TV'de gorunecek: Alis <b>" + PriceFormatter.formatCurrencyTL(usd.buy) +
        "</b> &middot; Satis <b>" + PriceFormatter.formatCurrencyTL(usd.sell) + "</b>";
    } else if (el) { el.innerHTML = "Piyasa verisi bekleniyor."; }
    el = byId("eur-preview");
    if (el && eur.buy !== null) {
      el.innerHTML = "TV'de gorunecek: Alis <b>" + PriceFormatter.formatCurrencyTL(eur.buy) +
        "</b> &middot; Satis <b>" + PriceFormatter.formatCurrencyTL(eur.sell) + "</b>";
    } else if (el) { el.innerHTML = "Piyasa verisi bekleniyor."; }
  }

  /* ---------- TV GORUNUM ---------- */
  /* IBAN listesi <-> textarea ("Banka | Hesap Sahibi | IBAN" satirlari).
   * Bos list = tema-2'nin dahili varsayilanlarini kullaniyor demek. */
  function ibanSerialize(list) {
    if (!list || !list.length) { return ""; }
    var out = [], i, it;
    for (i = 0; i < list.length; i++) {
      it = list[i] || {};
      out.push([it.bank || "", it.holder || "", it.iban || ""].join(" | "));
    }
    return out.join("\n");
  }
  function ibanParse(text) {
    var lines = String(text || "").split(/\r?\n/), out = [], i, parts, bank, holder, iban;
    for (i = 0; i < lines.length; i++) {
      if (!String(lines[i]).replace(/\s/g, "")) { continue; }
      parts = lines[i].split("|");
      bank = (parts[0] || "").replace(/^\s+|\s+$/g, "");
      holder = (parts[1] || "").replace(/^\s+|\s+$/g, "");
      iban = (parts[2] || "").replace(/^\s+|\s+$/g, "");
      if (!iban) { continue; }
      out.push({ bank: bank, holder: holder, iban: iban });
    }
    return out;
  }
  function saveTvView() {
    AppDb.update("settings", {
      goldDisplayMode: byId("gold-mode").value,
      currencySectionHidden: byId("cur-section-hide").checked,
      tvNote: byId("tv-note-input").value,
      theme: byId("tv-theme-select") ? byId("tv-theme-select").value : "dark",
      showThemeSwitcher: byId("theme-switch-show") ? byId("theme-switch-show").checked : true,
      whatsappEnabled: byId("wa-enable") ? byId("wa-enable").checked : true,
      whatsappNumber: byId("wa-number") ? byId("wa-number").value : "",
      whatsappMessage: byId("wa-message") ? byId("wa-message").value : "",
      ibanList: byId("iban-input") ? ibanParse(byId("iban-input").value) : []
    });
    logOp("tv.gorunum", byId("gold-mode").value);
    toast("TV gorunumu kaydedildi - ekrana aninda yansidi");
  }

  /* ---------- REKLAMLAR ---------- */
  function renderAds() {
    var tbl = byId("ads-table");
    if (!tbl) { return; }
    var html = "<tr><th>Baslik</th><th>Aciklama</th><th>Sure</th><th>Durum</th><th>&#304;slemler</th></tr>";
    var id, a;
    for (id in state.ads) {
      if (!state.ads.hasOwnProperty(id)) { continue; }
      a = state.ads[id];
      if (!a) { continue; }
      html += "<tr>" +
        "<td>" + escapeHtml(a.title) + "</td>" +
        "<td>" + escapeHtml(a.description) + "</td>" +
        "<td>" + (a.durationSec || 10) + " sn</td>" +
        "<td>" + (a.active === false ? "PASIF" : "AKTIF") + "</td>" +
        "<td>" +
        "<button class='btn-x' data-aid='" + escapeHtml(id) + "' data-aact='toggle'>" +
        (a.active === false ? "AKTIF YAP" : "PASIF YAP") + "</button> " +
        "<button class='btn-x btn-danger' data-aid='" + escapeHtml(id) + "' data-aact='del'>SIL</button>" +
        "</td></tr>";
    }
    tbl.innerHTML = html + (String(html).indexOf("data-aid") === -1 ?
      "<tr><td colspan='5' class='muted'>Reklam yok - TV varsayilan tasarimi gosterir.</td></tr>" : "");
    tbl.onclick = function (ev) {
      var el = ev.target;
      while (el && el !== this && !(el.getAttribute && el.getAttribute("data-aact"))) { el = el.parentNode; }
      if (!el || el === this) { return; }
      var aid = el.getAttribute("data-aid");
      var act = el.getAttribute("data-aact");
      if (act === "toggle") {
        AppDb.update("advertisements/" + aid, { active: state.ads[aid].active === false });
        logOp("reklam.durum", state.ads[aid].title || aid);
      } else if (act === "del") {
        if (window.confirm("Reklam silinsin mi?")) {
          AppDb.remove("advertisements/" + aid);
          logOp("reklam.sil", state.ads[aid].title || aid);
        }
      }
    };
  }

  function addAd() {
    var title = byId("ad-title").value;
    var desc = byId("ad-desc").value;
    var img = byId("ad-img").value;
    var dur = PriceValidator.toNumber(byId("ad-dur").value);
    if (!title && !img) { toast("Baslik veya gorsel gerekli"); return; }
    var maxOrder = 0, k;
    for (k in state.ads) {
      if (state.ads.hasOwnProperty(k) && state.ads[k]) { maxOrder = Math.max(maxOrder, state.ads[k].order || 0); }
    }
    AppDb.push("advertisements", {
      title: title,
      description: desc,
      imageUrl: img,
      durationSec: isFinite(dur) && dur >= 3 && dur <= 120 ? dur : 10,
      active: true,
      order: maxOrder + 1,
      createdAt: Date.now()
    });
    logOp("reklam.ekle", title);
    toast("Reklam eklendi");
    byId("ad-title").value = ""; byId("ad-desc").value = "";
    byId("ad-img").value = ""; byId("ad-dur").value = "";
  }

  /* ---------- BRANDIN ---------- */
  function syncBrandingUi() {
    var n = byId("brand-name-input");
    var l = byId("brand-logo-input");
    if (n && document.activeElement !== n) { n.value = state.branding.name || ""; }
    if (l && document.activeElement !== l) { l.value = state.branding.logoUrl || ""; }
  }
  function saveBranding() {
    AppDb.update("branding", {
      name: byId("brand-name-input").value,
      logoUrl: byId("brand-logo-input").value
    });
    logOp("marka.ayar", byId("brand-name-input").value);
    toast("Marka ayarlari kaydedildi");
  }

  /* ---------- BAGLANTI DURUMU ---------- */
  function renderConn() {
    var el = byId("conn-box");
    if (!el) { return; }
    var s = state.status || {};
    el.innerHTML = "Bulut hizmet durumu: <b>" + escapeHtml(s.harem || "veri yok") + "</b><br>" +
      "Not: " + escapeHtml(s.note || "-") + "<br>" +
      "Son kalp atışı: " + escapeHtml(s.at ? PriceFormatter.formatDateTime(s.at) : "-");
  }

  /* ---------- ADMIN UID / KURULUM ---------- */
  function saveAdminUid() {
    var v = byId("admin-uid-input").value;
    if (!v || v.length < 10) { toast("Gecersiz UID"); return; }
    if (state.rootAdminUid && !window.confirm("Root admin degisiyor. Emin misiniz?")) { return; }
    AppDb.set("admins/rootAdminUid", v);
    logOp("admin.uid", v);
    toast("Root admin kaydedildi");
  }

  function runSeed() {
    /* products alt dendesi yoksa baslangic degerlerini yazar.
       Not: admins/rootAdminUid ilk kez Firebase Console'dan yazilmali
       (kural dongusu nedeniyle). Console'da admins: {rootAdminUid: "UID"} ekleyin. */
    var hasProducts = false, k;
    for (k in state.products) {
      if (state.products.hasOwnProperty(k) && state.products[k]) { hasProducts = true; break; }
    }
    if (hasProducts) { toast("Urunler zaten var - onyukleme atlandi"); return; }
    if (!window.confirm("Baslangic urunleri eklensin mi?")) { return; }
    var i;
    /* Her urun tek tek set ile yazilir (sirali ve guvenli) */
    for (i = 0; i < INITIAL_PRODUCTS.length; i++) {
      AppDb.set("products/seed" + (i + 1 < 10 ? "0" + (i + 1) : (i + 1)), {
        name: INITIAL_PRODUCTS[i][0],
        buyMultiplier: INITIAL_PRODUCTS[i][1],
        sellMultiplier: INITIAL_PRODUCTS[i][2],
        active: true, tvVisible: true, archived: false,
        order: i + 1, createdAt: Date.now(), updatedAt: Date.now()
      });
    }
    AppDb.update("settings", {
      goldReference: "has_buy",
      goldDisplayMode: "both",
      currencyDisplayMode: "both",
      usdShowMode: "both",
      eurShowMode: "both",
      showUsd: true,
      showEur: true
    });
    logOp("kurulum.onyukleme", INITIAL_PRODUCTS.length + " urun");
    toast("Baslangic verileri yuklendi");
  }

  /* ---------- LOGS ---------- */
  function renderLogs() {
    var tbl = byId("logs-table");
    if (!tbl) { return; }
    var arr = [], id;
    for (id in state.logs) {
      if (state.logs.hasOwnProperty(id) && state.logs[id]) { arr.push(state.logs[id]); }
    }
    arr.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
    var html = "<tr><th>Zaman</th><th>Islem</th><th>Detay</th><th>Kullanici</th></tr>";
    var i, r;
    for (i = 0; i < Math.min(arr.length, 30); i++) {
      r = arr[i];
      html += "<tr><td>" + escapeHtml(r.at ? PriceFormatter.formatDateTime(r.at) : "-") + "</td><td>" +
        escapeHtml(r.action || "") + "</td><td>" + escapeHtml(r.detail || "") + "</td><td>" +
        escapeHtml(String(r.by || "").substring(0, 12)) + "</td></tr>";
    }
    tbl.innerHTML = html + (arr.length === 0 ? "<tr><td colspan='4' class='muted'>Kayit yok</td></tr>" : "");
  }

  /* ---------- KULLANICI EKRANI TASARIM YONETIMI (TALIMAT bolum 4-5) ----------
   * Tasarımlar ThemeRegistry'den gelir (genisletilebilir; yeni tasarım =
   * yeni kayıt). Yayınlama = settings.activeUserTheme yazma; bu yolu
   * Firebase kurallari yalnizca rootAdminUid'e aciktir (bolum 13).
   * Onizleme tv.html?uiTheme=<id>&uiPreview=1 ile ACILIR; Firebase'e
   * hicbir sey yazilmaz, yayinlanan tasarim degismez. */
  var themesBuilt = false;
  var previewThemeId = null;

  function uiThemeList() {
    if (window.ThemeRegistry && ThemeRegistry.all().length) { return ThemeRegistry.all(); }
    /* Guvenli yedek: registry yuklenmezse mevcut iki tasarim gorunsun. */
    return [
      { id: "theme-1", name: "Klasik Koyu Alt\u0131n", desc: "Mevcut kullan\u0131c\u0131 ekran\u0131.", rootId: "tv-dashboard" },
      { id: "theme-2", name: "Premium Ye\u015fil", desc: "Ye\u015fil/krem modern ekran.", rootId: "theme2-root" }
    ];
  }
  function activeUiTheme() {
    var t = state.settings && state.settings.activeUserTheme;
    var i, ok = false, list = uiThemeList();
    for (i = 0; i < list.length; i++) { if (list[i].id === t) { ok = true; } }
    return ok ? t : "theme-1";
  }
  function themeName(id) {
    var i, list = uiThemeList();
    for (i = 0; i < list.length; i++) { if (list[i].id === id) { return list[i].name; } }
    return id;
  }

  function renderThemesSection() {
    var box = byId("theme-cards");
    if (!box) { return; }
    if (!themesBuilt) {
      var list = uiThemeList(), html = "", i;
      for (i = 0; i < list.length; i++) {
        html += "<div class='theme-card' data-tid='" + escapeHtml(list[i].id) + "'>" +
          "<div class='theme-thumb'><iframe src='tv.html?uiTheme=" + encodeURIComponent(list[i].id) + "&uiThumb=1' scrolling='no' frameborder='0' title='" + escapeHtml(list[i].name) + " kucuk onizleme'></iframe></div>" +
          "<div class='theme-card-body'>" +
          "<div class='theme-card-title'><span class='tname'>" + escapeHtml(list[i].name) + "</span>" +
          "<span class='theme-badge' data-role='badge' style='display:none'>AKT\u0130F YAYIN</span></div>" +
          "<div class='theme-card-desc'>" + escapeHtml(list[i].desc) + "</div>" +
          "<div class='theme-card-actions'>" +
          "<button class='btn-x' type='button' data-tact='preview' data-tid='" + escapeHtml(list[i].id) + "'>&#214;NİZLE</button> " +
          "<button class='btn-x theme-publish-btn' type='button' data-tact='publish' data-tid='" + escapeHtml(list[i].id) + "'>SE\u00c7 VE YAYINLA</button>" +
          "</div></div></div>";
      }
      box.innerHTML = html;
      box.onclick = handleThemeCardClick;
      themesBuilt = true;
    }
    updateThemeCardsState();
  }

  function updateThemeCards() {
    var box = byId("theme-cards");
    if (!box || !themesBuilt) { return; }
    var active = activeUiTheme();
    var cards = box.childNodes, i, card, tid, badge, pub;
    for (i = 0; i < cards.length; i++) {
      card = cards[i];
      if (!card || !card.getAttribute) { continue; }
      tid = card.getAttribute("data-tid");
      badge = card.querySelector ? card.querySelector("[data-role=badge]") : null;
      pub = card.querySelector ? card.querySelector("[data-tact=publish]") : null;
      if (badge) { badge.style.display = tid === active ? "inline-block" : "none"; }
      if (card.setAttribute) { card.setAttribute("data-active", tid === active ? "1" : "0"); }
      if (pub) {
        pub.disabled = (tid === active);
        pub.innerHTML = tid === active ? "YAYINDA" : "SE\u00c7 VE YAYINLA";
      }
    }
    /* Eski tasarıma dönüş: yayınlanmadan önceki tasarım kayıtlıysa göster */
    var wrap = byId("theme-revert-wrap"), info = byId("theme-revert-info");
    var prev = state.settings && state.settings.prevUserTheme;
    var prevOk = false, j, list = uiThemeList();
    for (j = 0; j < list.length; j++) { if (list[j].id === prev) { prevOk = true; } }
    if (wrap) { wrap.style.display = (prevOk && prev !== active) ? "block" : "none"; }
    if (info && prevOk) {
      info.innerHTML = " \u00b7 Son yay\u0131n: " + escapeHtml(themeName(prev)) +
        " (" + (state.settings.activeUserThemeUpdatedAt ?
          PriceFormatter.formatDateTime(state.settings.activeUserThemeUpdatedAt) : "-") + ")";
    }
  }
  function updateThemeCardsState() { try { updateThemeCards(); } catch (e) {} }

  function handleThemeCardClick(ev) {
    var el = ev.target;
    while (el && el !== this && !(el.getAttribute && el.getAttribute("data-tact"))) { el = el.parentNode; }
    if (!el || el === this) { return; }
    var act = el.getAttribute("data-tact");
    var tid = el.getAttribute("data-tid");
    if (act === "preview") { openThemePreview(tid); }
    else if (act === "publish") { publishTheme(tid); }
  }

  function openThemePreview(id) {
    previewThemeId = id;
    var wrap = byId("theme-preview-wrap");
    if (!wrap) { return; }
    wrap.style.display = "block";
    var nm = byId("theme-preview-name");
    if (nm) { nm.innerHTML = escapeHtml(themeName(id)) + " <span class='muted'>(" + escapeHtml(id) + ")</span>"; }
    var frame = byId("theme-preview-frame");
    if (frame) { frame.src = "tv.html?uiTheme=" + encodeURIComponent(id) + "&uiPreview=1"; }
    setPreviewDevice("desktop");
    try { wrap.scrollIntoView(); } catch (e) {}
  }

  function setPreviewDevice(dev) {
    var stage = byId("theme-preview-stage");
    if (stage) { stage.className = "dev-" + dev; }
    var btns = document.getElementsByClassName("theme-dev-btns");
    var i, kids, j;
    if (btns.length) {
      kids = btns[0].getElementsByTagName("button");
      for (j = 0; j < kids.length; j++) {
        kids[j].className = (kids[j].getAttribute("data-dev") === dev) ? "btn-x dev-on" : "btn-x";
      }
    }
  }

  function publishTheme(id) {
    var active = activeUiTheme();
    if (id === active) { toast("Bu tasar\u0131m zaten yay\u0131nda."); return; }
    /* Yetki kontrolu (arayuz): Firebase kurallari yazmayi zaten yalnizca
     * rootAdminUid'e acar; burada erken ve okunur uyari verilir. */
    if (state.rootAdminUid && state.me && state.me.uid !== state.rootAdminUid) {
      toast("Yay\u0131nlama yetkisi yaln\u0131zca root admin i\u00e7in ge\u00e7erlidir.");
      return;
    }
    if (!window.confirm('"' + themeName(id) + '" tasar\u0131m\u0131 T\u00dcM cihazlarda (TV, telefon, bilgisayar) aktif olacak. Onayl\u0131yor musunuz?')) {
      return;
    }
    AppDb.update("settings", {
      prevUserTheme: active,
      activeUserTheme: id,
      activeUserThemeUpdatedAt: Date.now()
    }, function (err) {
      if (err) { toast("Yay\u0131nlanamad\u0131: " + (err.message || err) + " (yetki mi?)"); return; }
      /* Iyimser yerel guncelleme: 5 sn'lik poll beklenmez */
      state.settings.prevUserTheme = active;
      state.settings.activeUserTheme = id;
      state.settings.activeUserThemeUpdatedAt = Date.now();
      updateThemeCardsState();
      logOp("tasarim.yayinla", id + " (onceki: " + active + ")");
      toast("Yay\u0131nland\u0131 \u2014 a\u00e7\u0131k ekranlar sayfa yenilemeden yeni tasar\u0131ma ge\u00e7ti");
    });
  }

  function bindThemeSection() {
    var devBtns = document.getElementsByClassName("theme-dev-btns");
    if (devBtns.length) {
      devBtns[0].onclick = function (ev) {
        var el = ev.target;
        while (el && el !== this && !(el.getAttribute && el.getAttribute("data-dev"))) { el = el.parentNode; }
        if (!el || el === this) { return; }
        var dev = el.getAttribute("data-dev");
        if (dev) { setPreviewDevice(dev); }
      };
    }
    var close = byId("btn-theme-preview-close");
    if (close) {
      close.onclick = function () {
        var wrap = byId("theme-preview-wrap");
        if (wrap) { wrap.style.display = "none"; }
        var frame = byId("theme-preview-frame");
        if (frame) { frame.src = "about:blank"; }
        previewThemeId = null;
      };
    }
    var pubP = byId("btn-theme-publish-preview");
    if (pubP) { pubP.onclick = function () { if (previewThemeId) { publishTheme(previewThemeId); } }; }
    var rev = byId("btn-theme-revert");
    if (rev) {
      rev.onclick = function () {
        var prev = state.settings && state.settings.prevUserTheme;
        if (prev) { publishTheme(prev); }
      };
    }
  }

  /* ---------- MENU ---------- */
  function setupMenu() {
    var items = document.getElementsByClassName("menu-item");
    var i;
    for (i = 0; i < items.length; i++) {
      items[i].onclick = function () {
        var secId = this.getAttribute("data-section");
        if (!secId) { return; }
        var secs = document.getElementsByClassName("section");
        var j;
        for (j = 0; j < secs.length; j++) { secs[j].style.display = "none"; }
        var sec = byId(secId);
        if (sec) { sec.style.display = "block"; }
        for (j = 0; j < items.length; j++) { items[j].className = "menu-item"; }
        this.className = "menu-item active";
        if (secId === "sec-preview") { try { byId("tv-preview-frame").src = "tv.html"; } catch (e) {} }
        if (secId === "sec-themes") { try { renderThemesSection(); } catch (e) {} }
      };
    }
  }

  /* ---------- MAIN ---------- */
  function main() {
    requireAuth(function () {
      try { setupMenu(); } catch (e) {}
      try { subscribeAll(); } catch (e) { toast("Abonelık hatası: " + e.message); }

      try { maybeStartHaremFallback(); } catch (e) {}
      byId("btn-logout").onclick = function () { AppDb.logout(); window.location.href = "login.html"; };
      byId("btn-add-product").onclick = addProduct;
      var eSave = byId("edit-save"), eCancel = byId("edit-cancel"), eModal = byId("edit-modal");
      if (eSave) { eSave.onclick = saveEdit; }
      if (eCancel) { eCancel.onclick = closeEdit; }
      if (eModal) { eModal.onclick = function (ev) { if (ev && ev.target === eModal) { closeEdit(); } }; }
      byId("btn-add-ad").onclick = addAd;
      byId("btn-save-tvview").onclick = saveTvView;
      byId("btn-save-branding").onclick = saveBranding;
      byId("btn-save-admin").onclick = saveAdminUid;
      try { bindThemeSection(); } catch (e) {}
      var seedBtn = byId("btn-run-seed");
      if (seedBtn) { seedBtn.onclick = runSeed; }

      /* Gorsel yukleme baglayicilari (Storage yapilandirilmadiysa hata verir, cokmez) */
      try {
        bindUpload("btn-ad-upload", "ad-file", "ad-img", "ads", "ad-upload-status");
        bindUpload("btn-logo-upload", "brand-logo-file", "brand-logo-input", "branding", "logo-upload-status");
      } catch (e) {}

      byId("gr-buy").onchange = function () { if (this.checked) { setGoldReference("has_buy"); } };
      byId("gr-sell").onchange = function () { if (this.checked) { setGoldReference("has_sell"); } };

      /* USD/EUR alanlari: odak cikinca otomatik kaydet */
      bindAutoSave("usd-buy-adj", saveUsd);
      bindAutoSave("usd-sell-adj", saveUsd);
      bindAutoSave("eur-buy-adj", saveEur);
      bindAutoSave("eur-sell-adj", saveEur);
      byId("usd-show").onchange = saveUsd;
      byId("usd-mode").onchange = saveUsd;
      byId("eur-show").onchange = saveEur;
      byId("eur-mode").onchange = saveEur;

      /* Arsiv/kurulum dugmesi gorunurlugu */
      var sb = byId("sec-setup-box");
      if (sb) { sb.style.display = "block"; }
    });
  }

  function bindAutoSave(id, fn) {
    var el = byId(id);
    if (el) {
      el.onblur = function () { try { fn(); } catch (e) {} };
    }
  }

  /* Firebase Storage dosya yukleme: dugme -> file dialog -> yukle -> URL'e yaz */
  function uploadStatus(id, txt) {
    var el = byId(id);
    if (el) { el.innerHTML = escapeHtml(txt); }
  }
  function bindUpload(btnId, fileId, targetInputId, folder, statusId) {
    var btn = byId(btnId), file = byId(fileId);
    if (!btn || !file) { return; }
    btn.onclick = function () { try { file.click(); } catch (e) {} };
    file.onchange = function () {
      var f = file.files && file.files[0];
      if (!f) { return; }
      uploadStatus(statusId, "Yukleniyor...");
      try {
        AppDb.uploadImage(f, folder, function (pct) {
          uploadStatus(statusId, "%" + pct);
        }, function (err, url) {
          if (err) { uploadStatus(statusId, "Hata"); toast("Gorsel yuklenemedi: " + err.message); return; }
          var target = byId(targetInputId);
          if (target) { target.value = url; }
          uploadStatus(statusId, "Yuklendi \u2713");
          toast("Gorsel Storage'a yuklendi, URL alana yazildi");
        });
      } catch (e) { uploadStatus(statusId, "Hata"); toast("Storage hazir degil: " + e.message); }
    };
  }

  try {
    if (document.addEventListener) {
      document.addEventListener("DOMContentLoaded", function () { try { main(); } catch (e) { alert(e.message); } });
    } else { window.onload = main; }
  } catch (e) {}
})();
