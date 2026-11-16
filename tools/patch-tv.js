"use strict";
const fs = require("fs");

// 1. PATCH TV.JS
let tv = fs.readFileSync("public/js/tv.js", "utf8");

// effectiveStale update
const oldStale = `function effectiveStale() {
    if (!state.market) { return true; }
    var info = PriceFormatter.freshnessInfo(
      state.market.updatedAt, Date.now(),
      (window.APP_CONFIG && window.APP_CONFIG.staleLimitMs) || 180000
    );
    return !info.fresh;
  }`;

const newStale = `function effectiveStale() {
    if (!state.market) { return true; }
    var viaFallbackFresh = fbAppliedAt > 0 &&
      (Date.now() - fbAppliedAt) < ((window.APP_CONFIG && window.APP_CONFIG.staleLimitMs) || 180000);
    if (viaFallbackFresh) { return false; }
    var info = PriceFormatter.freshnessInfo(
      state.market.updatedAt, Date.now(),
      (window.APP_CONFIG && window.APP_CONFIG.staleLimitMs) || 180000
    );
    return !info.fresh;
  }`;

tv = tv.split("\r\n").join("\n");
tv = tv.replace(oldStale.split("\r\n").join("\n"), newStale.split("\r\n").join("\n"));

// Harem socket connect subscribe emit
const oldConn = 'haremSocket.on("connect", function () { haremRetryMs = 5000; });';
const newConn = `haremSocket.on("connect", function () {
        haremRetryMs = 5000;
        try {
          haremSocket.emit("subscribe", ["ALTIN", "USDTRY", "EURTRY"]);
          setTimeout(function () { try { haremSocket.emit("subscribe", { symbols: ["ALTIN", "USDTRY", "EURTRY"] }); } catch (e) {} }, 1500);
          setTimeout(function () { try { haremSocket.emit("join", ["ALTIN", "USDTRY", "EURTRY"]); } catch (e) {} }, 3000);
        } catch (e) {}
      });`;
tv = tv.replace(oldConn, newConn);

// applyFallbackPayload
const oldFbPayload = `      var t = (res.meta && isFinite(Number(res.meta.time)))
        ? Number(res.meta.time) : Date.now();
      /* Bulut akisi tazeyse yedek KULLANILMAZ (tek dogru kaynak buluttur). */
      if (state.market && state.market.updatedAt && state.market.updatedAt >= t) { return; }`;

const newFbPayload = `      var t = Date.now();
      /* Bulut akisi son 3 dakika icinde geldiyse ve gercekten tazeyse yedek yerine bulut kalir */
      var cloudFresh = state.market && state.market.source !== "browser-fallback" &&
        state.market.updatedAt && (Date.now() - state.market.updatedAt < 180000);
      if (cloudFresh) { return; }`;

tv = tv.replace(oldFbPayload.split("\r\n").join("\n"), newFbPayload.split("\r\n").join("\n"));

// update status to connected in applyFallbackPayload
const oldFbApplied = `      fbAppliedAt = Date.now();
      try { AppDb.cacheMarket(merged); } catch (e) {}`;
const newFbApplied = `      fbAppliedAt = Date.now();
      if (!state.status) { state.status = {}; }
      state.status.harem = "connected";
      try { AppDb.cacheMarket(merged); } catch (e) {}`;
tv = tv.replace(oldFbApplied.split("\r\n").join("\n"), newFbApplied.split("\r\n").join("\n"));

// local socket.io first
tv = tv.replace(
  `"https://cdn.socket.io/4.4.1/socket.io.min.js",
      "https://cdnjs.cloudflare.com/ajax/libs/socket.io/4.4.1/socket.io.min.js",
      "js/lib/socket.io.min.js"`,
  `"js/lib/socket.io.min.js",
      "https://cdn.socket.io/4.4.1/socket.io.min.js",
      "https://cdnjs.cloudflare.com/ajax/libs/socket.io/4.4.1/socket.io.min.js"`
);

fs.writeFileSync("public/js/tv.js", tv.split("\n").join("\r\n"), "utf8");
console.log("TV.JS successfully patched!");
