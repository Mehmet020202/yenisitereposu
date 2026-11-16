"use strict";
const fs = require("fs");

let admin = fs.readFileSync("public/js/admin.js", "utf8");
admin = admin.split("\r\n").join("\n");

// 1. haremAdminSocket connect subscribe emit
const oldAdminConn = 'haremAdminSocket.on("connect", function () { haremAdminRetryMs = 5000; });';
const newAdminConn = `haremAdminSocket.on("connect", function () {
        haremAdminRetryMs = 5000;
        try {
          haremAdminSocket.emit("subscribe", ["ALTIN", "USDTRY", "EURTRY"]);
          setTimeout(function () { try { haremAdminSocket.emit("subscribe", { symbols: ["ALTIN", "USDTRY", "EURTRY"] }); } catch (e) {} }, 1500);
          setTimeout(function () { try { haremAdminSocket.emit("join", ["ALTIN", "USDTRY", "EURTRY"]); } catch (e) {} }, 3000);
        } catch (e) {}
      });`;
admin = admin.replace(oldAdminConn, newAdminConn);

// 2. applyHaremPayload t = Date.now() & auto sync to Firebase
const oldHaremPayload = `      var t = (res.meta && isFinite(Number(res.meta.time))) ? Number(res.meta.time) : Date.now();
      if (state.market && state.market.updatedAt && state.market.updatedAt >= t) { return; }
      var merged = {}, k;
      if (state.market) { for (k in state.market) { if (state.market.hasOwnProperty(k)) { merged[k] = state.market[k]; } } }
      for (k in out) { if (out.hasOwnProperty(k)) { merged[k] = out[k]; } }
      merged.updatedAt = t; merged.source = "browser-fallback";
      state.market = merged;
      renderMarket(); renderOverview(); renderHasPreview(); renderCurPreviews();`;

const newHaremPayload = `      var t = Date.now();
      var cloudFresh = state.market && state.market.source !== "browser-fallback" &&
        state.market.updatedAt && (Date.now() - state.market.updatedAt < 180000);
      if (cloudFresh) { return; }
      var merged = {}, k;
      if (state.market) { for (k in state.market) { if (state.market.hasOwnProperty(k)) { merged[k] = state.market[k]; } } }
      for (k in out) { if (out.hasOwnProperty(k)) { merged[k] = out[k]; } }
      merged.updatedAt = t; merged.source = "browser-fallback";
      state.market = merged;
      renderMarket(); renderOverview(); renderHasPreview(); renderCurPreviews();

      /* Canli fiyati Firebase'e de senkronize et (bulut servisi kapaliysa admin paneli besler) */
      syncLivePriceToFirebase(merged);`;

admin = admin.replace(oldHaremPayload, newHaremPayload);

// Add syncLivePriceToFirebase function definition before maybeStartHaremFallback
const syncHelper = `  var lastFbSyncAt = 0;
  function syncLivePriceToFirebase(payload) {
    try {
      if (!state.me || !state.me.uid) { return; }
      if (Date.now() - lastFbSyncAt < 15000) { return; } // En fazla 15 sn'de bir yaz
      lastFbSyncAt = Date.now();
      var fbPayload = {
        hasBuy: payload.hasBuy || 0,
        hasSell: payload.hasSell || 0,
        usdBuy: payload.usdBuy || 0,
        usdSell: payload.usdSell || 0,
        eurBuy: payload.eurBuy || 0,
        eurSell: payload.eurSell || 0,
        updatedAt: Date.now(),
        source: "admin-live-sync"
      };
      if (payload.hasBuyDir) { fbPayload.hasBuyDir = payload.hasBuyDir; }
      if (payload.hasSellDir) { fbPayload.hasSellDir = payload.hasSellDir; }
      if (payload.usdBuyDir) { fbPayload.usdBuyDir = payload.usdBuyDir; }
      if (payload.usdSellDir) { fbPayload.usdSellDir = payload.usdSellDir; }
      if (payload.eurBuyDir) { fbPayload.eurBuyDir = payload.eurBuyDir; }
      if (payload.eurSellDir) { fbPayload.eurSellDir = payload.eurSellDir; }
      AppDb.update("marketPrices", fbPayload, function (err) {
        if (!err) {
          AppDb.update("connectionStatus", { harem: "connected", note: "admin paneli canli akisi", at: Date.now() });
        }
      });
    } catch (e) {}
  }
`;

admin = admin.replace(
  'function maybeStartHaremFallback() {',
  syncHelper + '\n  function maybeStartHaremFallback() {'
);

// 3. local socket.io first in loadScriptAdminList
admin = admin.replace(
  `"https://cdn.socket.io/4.4.1/socket.io.min.js",
      "https://cdnjs.cloudflare.com/ajax/libs/socket.io/4.4.1/socket.io.min.js",
      "js/lib/socket.io.min.js"`,
  `"js/lib/socket.io.min.js",
      "https://cdn.socket.io/4.4.1/socket.io.min.js",
      "https://cdnjs.cloudflare.com/ajax/libs/socket.io/4.4.1/socket.io.min.js"`
);

// 4. Auto claim rootAdminUid if not set or matches
const oldRootSub = `    AppDb.subscribe("admins/rootAdminUid", function (v) {
      state.rootAdminUid = v;
      var el = byId("admin-uid-current");
      if (el) { el.innerHTML = v ? escapeHtml(v) : "ATANMAMIS"; }
      var inp = byId("admin-uid-input");
      if (inp && v && !inp.value) { inp.value = v; }
      try { updatePermBanner(); } catch (e) {}
    });`;

const newRootSub = `    AppDb.subscribe("admins/rootAdminUid", function (v) {
      state.rootAdminUid = v;
      var el = byId("admin-uid-current");
      if (el) { el.innerHTML = v ? escapeHtml(v) : "ATANMAMIS"; }
      var inp = byId("admin-uid-input");
      if (inp && v && !inp.value) { inp.value = v; }
      
      // Eger rootAdminUid atanmamis ise ve giris yapmis bir yonetici varsa, otomatik ata!
      if (!v && state.me && state.me.uid) {
        AppDb.set("admins/rootAdminUid", state.me.uid, function (err) {
          if (!err) {
            state.rootAdminUid = state.me.uid;
            if (el) { el.innerHTML = escapeHtml(state.me.uid); }
            if (inp) { inp.value = state.me.uid; }
            toast("Yonetici yetkisi (rootAdminUid) otomatik olarak hesabinizla eslestirildi.");
          }
        });
      }
      try { updatePermBanner(); } catch (e) {}
    });`;

admin = admin.replace(oldRootSub, newRootSub);

// 5. Optimistic UI update in addProduct
const oldAddProd = `    dbWrite("push", "products", rec, "Urun ekleme", function (res) {
      var newId = (res && res.name) ? res.name : null;
      if (newId) { rec._id = newId; state.products[newId] = rec; }
      logOp("urun.ekle", name);
      toast("Urun eklendi - TV ekraninda gorunuyor");
      byId("np-name").value = ""; byId("np-buy").value = "";
      byId("np-sell").value = ""; byId("np-img").value = "";
      renderProducts(); renderOverview(); renderHasPreview();
    });`;

const newAddProd = `    // Optimistic (aninda) arayuz guncellemesi
    var tempId = "tmp_" + Date.now();
    rec._id = tempId;
    state.products[tempId] = rec;
    renderProducts(); renderOverview(); renderHasPreview();
    byId("np-name").value = ""; byId("np-buy").value = "";
    byId("np-sell").value = ""; byId("np-img").value = "";

    dbWrite("push", "products", rec, "Urun ekleme", function (res) {
      var newId = (res && res.name) ? res.name : null;
      delete state.products[tempId];
      if (newId) {
        rec._id = newId;
        state.products[newId] = rec;
      }
      logOp("urun.ekle", name);
      toast("Urun eklendi - TV ekraninda gorunuyor");
      renderProducts(); renderOverview(); renderHasPreview();
    });`;

admin = admin.replace(oldAddProd, newAddProd);

fs.writeFileSync("public/js/admin.js", admin.split("\n").join("\r\n"), "utf8");
console.log("ADMIN.JS successfully patched!");
