/* =====================================================================
 * ALTUĞ KUYUMCULUK - HAS Hesaplama Motoru (ES5, eski tarayıcı uyumlu)
 * =====================================================================
 * Kesin hesaplama kuralı:
 *  - Alış ve satış AYNI ortak HAS referansından hesaplanır.
 *  - goldReference = "has_buy"  -> bütün ürünler HAS ALIŞ bazlı
 *  - goldReference = "has_sell" -> bütün ürünler HAS SATIŞ bazlı
 *  - USD/EUR düzeltmeleri ALTI değil, doğrudan TL eklenip çıkarılır.
 *  - Hesaplama sırasında YUVARLAMA YOKTUR; yuvarlama yalnızca gösterimde
 *    (PriceFormatter) yapılır.
 * ===================================================================== */

var PriceEngine = (function () {
  "use strict";

  var ONS_GRAM = 31.1034768; /* 1 ons (troy oz) = 31.1034768 g */

  /* Ortak HAS referans değerini seçer. */
  function getBasePrice(market, settings) {
    var ref = settings && settings.goldReference ? settings.goldReference : "has_buy";
    var base = ref === "has_sell" ? market.hasSell : market.hasBuy;
    var n = parseFloat(base);
    if (!isFinite(n) || n <= 0) { return null; }
    return n;
  }

  /* Tek ürün için alış/satış hesaplar.
   * Ürün nesnesi: { name, buyMultiplier, sellMultiplier, ... } */
  function calcProduct(product, market, settings) {
    var base = getBasePrice(market, settings);
    if (base === null) { return null; }
    var buyM = parseFloat(product.buyMultiplier);
    var sellM = parseFloat(product.sellMultiplier);
    var out = { base: base, buy: null, sell: null };
    if (isFinite(buyM) && buyM > 0) { out.buy = base * buyM; }
    if (isFinite(sellM) && sellM > 0) { out.sell = base * sellM; }
    return out;
  }

  /* Bütün aktif ürünleri hesaplar.
   * Sonuç: { "ID": { buy, sell, base }, ... } */
  function calcAll(products, market, settings) {
    var results = {};
    var id, p;
    if (!products) { return results; }
    for (id in products) {
      if (!products.hasOwnProperty(id)) { continue; }
      p = products[id];
      if (!p || p.archived === true || p.active === false) { continue; }
      results[id] = calcProduct(p, market, settings);
    }
    return results;
  }

  /* USD/EUR: sabit TL düzeltmesi (pozitif/negatif kabul edilir). */
  function calcCurrency(buyRaw, sellRaw, adjBuy, adjSell) {
    var b = parseFloat(buyRaw);
    var s = parseFloat(sellRaw);
    var ab = parseFloat(adjBuy);
    var as = parseFloat(adjSell);
    if (isNaN(ab)) { ab = 0; }
    if (isNaN(as)) { as = 0; }
    return {
      buy: isFinite(b) ? b + ab : null,
      sell: isFinite(s) ? s + as : null
    };
  }

  function calcUsd(market, adjustments) {
    adjustments = adjustments || {};
    return calcCurrency(market.usdBuy, market.usdSell,
      adjustments.usdBuyAdjustment, adjustments.usdSellAdjustment);
  }

  function calcEur(market, adjustments) {
    adjustments = adjustments || {};
    return calcCurrency(market.eurBuy, market.eurSell,
      adjustments.eurBuyAdjustment, adjustments.eurSellAdjustment);
  }

  /* ONS ($) = ons TRY / USD-TRY = (gram x 31.1034768) / usd.
   * Harem akisinda dogrudan ons alani YOK; gram ve usd'den HESAPLANIR.
   * Gösterilen USD kartiyla tutarli olmasi icin düzeltilmis (calcUsd) kuru kullanilir. */
  function calcOns(market, adjustments) {
    adjustments = adjustments || {};
    var gb = parseFloat(market.hasBuy), gs = parseFloat(market.hasSell);
    var usd = calcUsd(market, adjustments);
    var out = { buy: null, sell: null };
    if (isFinite(gb) && gb > 0 && isFinite(usd.buy) && usd.buy > 0) { out.buy = gb * ONS_GRAM / usd.buy; }
    if (isFinite(gs) && gs > 0 && isFinite(usd.sell) && usd.sell > 0) { out.sell = gs * ONS_GRAM / usd.sell; }
    return out;
  }

  return {
    getBasePrice: getBasePrice,
    calcProduct: calcProduct,
    calcAll: calcAll,
    calcUsd: calcUsd,
    calcEur: calcEur,
    calcOns: calcOns
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = PriceEngine;
}
