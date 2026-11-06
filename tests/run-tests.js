/* =====================================================================
 * ALTUĞ KUYUMCULUK - Motor Testleri (hesaplama + dogrulama + bicim)
 * Calistirma (gelistirme makinesi veya CI): node tests/run-tests.js
 * Not: Bu test KULLANICIDAN Node kurulumu istemez; üretim sistemi
 * tarayici + bulut uzerinde calisir. tests.html tarayici esdegeridir.
 * ===================================================================== */

"use strict";

const assert = require("assert");
const PriceValidator = require("../public/js/price-validator.js");
const PriceEngine = require("../public/js/price-engine.js");
const PriceFormatter = require("../public/js/price-formatter.js");
const HaremMap = require("../cloud/price-ingestion/harem-map.js");

let passed = 0;
function t(name, fn) {
  fn();
  passed++;
  console.log("PASS  " + name);
}

const market = {
  hasBuy: 5600, hasSell: 5620,
  usdBuy: 50.10, usdSell: 50.10,
  eurBuy: 54.10, eurSell: 54.20
};

t("Test 1 - HAS ALI referansi: Tam Altin 6,36/6,50 -> 35.616/36.400", () => {
  const r = PriceEngine.calcProduct(
    { buyMultiplier: 6.36, sellMultiplier: 6.50 },
    market, { goldReference: "has_buy" });
  assert.ok(Math.abs(r.buy - 35616) < 1e-9);
  assert.ok(Math.abs(r.sell - 36400) < 1e-9);
});

t("Test 2 - HAS SATI referansi: alis de yeni ortak referanstan", () => {
  const r = PriceEngine.calcProduct(
    { buyMultiplier: 6.36, sellMultiplier: 6.50 },
    market, { goldReference: "has_sell" });
  assert.ok(Math.abs(r.buy - 5620 * 6.36) < 1e-9);
  assert.ok(Math.abs(r.sell - 5620 * 6.50) < 1e-9);
});

t("Test 3 - Urun ekleme: calcAll yeni urunu kapsar", () => {
  const all = PriceEngine.calcAll({
    a: { buyMultiplier: 1, sellMultiplier: 1.05, active: true, archived: false },
    b: { buyMultiplier: 2, sellMultiplier: 2.1, active: true, archived: false }
  }, market, { goldReference: "has_buy" });
  assert.ok(all.a && all.b);
  assert.ok(Math.abs(all.b.buy - 11200) < 1e-9);
});

t("Test 4 - Carpan degisimi -> yeniden hesaplama", () => {
  const p = { buyMultiplier: 1, sellMultiplier: 1.05 };
  const r1 = PriceEngine.calcProduct(p, market, {});
  p.buyMultiplier = 1.2;
  const r2 = PriceEngine.calcProduct(p, market, {});
  assert.ok(Math.abs(r1.buy - 5600) < 1e-9);
  assert.ok(Math.abs(r2.buy - 6720) < 1e-9);
});

t("Test 5 - Arsiv/pasif urun hesap disasi, kayitli urun silinmez", () => {
  const all = PriceEngine.calcAll({
    a: { buyMultiplier: 1, sellMultiplier: 1, active: true, archived: true },
    b: { buyMultiplier: 1, sellMultiplier: 1, active: false },
    c: { buyMultiplier: 1, sellMultiplier: 1, active: true, archived: false, tvVisible: false }
  }, market, {});
  assert.strictEqual(all.a, undefined);
  assert.strictEqual(all.b, undefined);
  assert.ok(all.c); /* tvVisible yalnizca gosterimi etkiler, kayit durur */
});

t("Test 6 - USD sabit TL duzeltmesi: 50,10+0,20 / 50,10+0,30", () => {
  const r = PriceEngine.calcUsd(market, { usdBuyAdjustment: 0.20, usdSellAdjustment: 0.30 });
  assert.ok(Math.abs(r.buy - 50.30) < 1e-9);
  assert.ok(Math.abs(r.sell - 50.40) < 1e-9);
});

t("EUR duzeltmesi negatif deger kabul eder", () => {
  const r = PriceEngine.calcEur(market, { eurBuyAdjustment: -1.10, eurSellAdjustment: 0 });
  assert.ok(Math.abs(r.buy - 53.00) < 1e-9);
});

t("Test 9 - Gecersiz veri reddi (sifir/negatif/NaN/Infinity/sicrama)", () => {
  assert.strictEqual(PriceValidator.validatePrice(0, 5600, 0.3).ok, false);
  assert.strictEqual(PriceValidator.validatePrice(-5, 5600, 0.3).ok, false);
  assert.strictEqual(PriceValidator.validatePrice("abc", 5600, 0.3).ok, false);
  assert.strictEqual(PriceValidator.validatePrice(null, 5600, 0.3).ok, false);
  assert.strictEqual(PriceValidator.validatePrice(Infinity, 5600, 0.3).ok, false);
  assert.strictEqual(PriceValidator.validatePrice(9000, 5600, 0.3).ok, false); /* %61 */
  assert.strictEqual(PriceValidator.validatePrice(5700, 5600, 0.3).ok, true);  /* %1,8 */
});

t("Eksik alan reddi (validateMarketPayload)", () => {
  const r = PriceValidator.validateMarketPayload(
    { hasBuy: 5600, hasSell: 5620, usdBuy: 50, usdSell: 50, eurBuy: 54 },
    market, 0.3);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.eurSell);
});

t("Türkçe sayi çevrimi: '5.600,00' -> 5600", () => {
  assert.strictEqual(PriceValidator.toNumber("5.600,00"), 5600);
  assert.strictEqual(PriceValidator.toNumber("50,10"), 50.1);
});

t("Bicimlendirme: 35616 -> '35.616,00 TL' (yuvarlama yalnizca gosterimde)", () => {
  assert.strictEqual(PriceFormatter.formatTL(35616), "35.616,00 TL");
  assert.strictEqual(PriceFormatter.formatTL(35616.0049), "35.616,00 TL");
  assert.strictEqual(PriceFormatter.formatNumber(1234567.891), "1.234.567,89");
});

t("Tazelik: 5 dk onceki veri 'guncel degil'", () => {
  const now = Date.now();
  const old = PriceFormatter.freshnessInfo(now - 300000, now, 180000);
  const fresh = PriceFormatter.freshnessInfo(now - 5000, now, 180000);
  assert.strictEqual(old.fresh, false);
  assert.strictEqual(fresh.fresh, true);
});

/* ---- CANLI DOGRULANMIS Harem semasi uzerinden uctan uca test ----
 * 2026-11-03 probe'undan gercek price_changed ornegi (ag gerektirmez). */
const REAL_PAYLOAD = {
  meta: { time: 1793715145592 },
  data: {
    USDTRY: { code: "USDTRY", alis: "50.0700", satis: "50.1500", kapanis: 49.857 },
    ALTIN: { code: "ALTIN", alis: "6369.490", satis: "6391.270", kapanis: 6465.48 },
    EURTRY: { code: "EURTRY", alis: "55.8530", satis: "56.0050", kapanis: 55.653 }
  }
};

/* index.js handlePrice'in indirme mantiginin tirdan karsiligi */
function extractMarket(payload) {
  const symRoot = (payload.data && typeof payload.data === "object") ? payload.data : payload;
  let merged = {};
  Object.keys(symRoot).forEach((sym) => {
    const rec = symRoot[sym];
    if (rec && typeof rec === "object") {
      const m = HaremMap.mapPriceMessage(sym, rec);
      if (m) Object.assign(merged, m);
    }
  });
  return merged;
}

t("Harem gercek sema: data.altis/satis -> hasBuy/usdBuy/eurBuy dogru ayrisir", () => {
  const m = extractMarket(REAL_PAYLOAD);
  assert.ok(Math.abs(m.hasBuy - 6369.49) < 1e-6, "hasBuy=" + m.hasBuy);
  assert.ok(Math.abs(m.hasSell - 6391.27) < 1e-6);
  assert.ok(Math.abs(m.usdBuy - 50.07) < 1e-6);
  assert.ok(Math.abs(m.usdSell - 50.15) < 1e-6);
  assert.ok(Math.abs(m.eurBuy - 55.853) < 1e-6);
});

t("Harem meta.time gercek sunucu zaman damgasi olarak okunur", () => {
  const t2 = REAL_PAYLOAD.meta.time;
  assert.ok(typeof t2 === "number" && t2 > 0);
});

t("Uctan uca: gercek ALTIN fiyati -> HAS referansi ile urun hesaplanir", () => {
  const m = extractMarket(REAL_PAYLOAD);
  // validator'dan gecmeli (string->sayi)
  const v = HaremMap.validateFieldPair("hasBuy", HaremMap.toNumber(m.hasBuy), 6369.49, 0.3);
  assert.strictEqual(v.ok, true);
  const r = PriceEngine.calcProduct(
    { buyMultiplier: 6.36, sellMultiplier: 6.50 }, m, { goldReference: "has_buy" });
  assert.ok(Math.abs(r.buy - 6369.49 * 6.36) < 1e-4);
  assert.ok(Math.abs(r.sell - 6369.49 * 6.50) < 1e-4);
});

t("Yon (dir): alis_dir/satis_dir -> BuyDir/SellDir; bilinmeyen deger filtrelenir", () => {
  const withDir = {
    meta: { time: 1793715145600 },
    data: {
      ALTIN: { alis: "6369.49", satis: "6391.27", dir: { alis_dir: "up", satis_dir: "down" } },
      USDTRY: { alis: "50.07", satis: "50.15", dir: { satis_dir: "same" } }
    }
  };
  const m = extractMarket(withDir);
  assert.strictEqual(m.hasBuyDir, "up");
  assert.strictEqual(m.hasSellDir, "down");
  assert.strictEqual(m.usdBuyDir, undefined);
  assert.strictEqual(m.usdSellDir, undefined, "'same' gibi bilinmeyen yon kaydedilmemeli");
});

t("Yon dogrulama: Dir alanlari up/down beyazi; sayi/hurafe reddedilir", () => {
  assert.strictEqual(HaremMap.validateFieldPair("hasBuyDir", "up", undefined, 0.3).ok, true);
  assert.strictEqual(HaremMap.validateFieldPair("usdSellDir", "down", undefined, 0.3).ok, true);
  assert.strictEqual(HaremMap.validateFieldPair("hasBuyDir", "sahte", undefined, 0.3).ok, false);
  assert.strictEqual(HaremMap.validateFieldPair("hasBuyDir", 12, undefined, 0.3).ok, false);
});

console.log("\nTOPLAM: " + passed + " test gecti.");
