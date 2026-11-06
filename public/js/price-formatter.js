/* =====================================================================
 * ALTUĞ KUYUMCULUK - Türkçe Fiyat / Zaman Biçimlendirme (ES5)
 * =====================================================================
 * Yuvarlama YALNIZCA burada, gösterim aşamasında yapılır.
 * Beklenen çıktı örneği: "35.616,00 TL"
 * ===================================================================== */

var PriceFormatter = (function () {
  "use strict";

  /* Sayıyı Türkçe biçime çevirir: 35616 -> "35.616,00" */
  function formatNumber(value, decimals) {
    if (typeof decimals === "undefined") { decimals = 2; }
    var n = parseFloat(value);
    if (!isFinite(n)) { return "-"; }
    var fixed = n.toFixed(decimals);
    var neg = fixed.charAt(0) === "-";
    if (neg) { fixed = fixed.substring(1); }
    var parts = fixed.split(".");
    var intPart = parts[0];
    var decPart = parts.length > 1 ? parts[1] : "";
    var withDots = "";
    var count = 0;
    var i;
    for (i = intPart.length - 1; i >= 0; i--) {
      withDots = intPart.charAt(i) + withDots;
      count++;
      if (count % 3 === 0 && i > 0) { withDots = "." + withDots; }
    }
    var out = withDots;
    if (decimals > 0) { out += "," + decPart; }
    return (neg ? "-" : "") + out;
  }

  function formatTL(value, decimals) {
    var s = formatNumber(value, typeof decimals === "undefined" ? 2 : decimals);
    return s === "-" ? "-" : s + " TL";
  }

  /* Döviz için daha küçük gösterim: 50,30 TL */
  function formatCurrencyTL(value) {
    return formatTL(value, 2);
  }

  /* Ons/dolar gösterimi: 4066 -> "4.066,00 $" */
  function formatUSD(value, decimals) {
    var s = formatNumber(value, typeof decimals === "undefined" ? 2 : decimals);
    return s === "-" ? "-" : s + " $";
  }

  /* 13 rakamlı zaman damgalarından "dd.MM.yyyy HH:mm:ss" */
  function formatDateTime(ts) {
    var d = ts ? new Date(ts) : new Date();
    function pad(x) { return x < 10 ? "0" + x : "" + x; }
    return pad(d.getDate()) + "." + pad(d.getMonth() + 1) + "." + d.getFullYear() +
      " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
  }

  function formatDate(ts) {
    var d = ts ? new Date(ts) : new Date();
    function pad(x) { return x < 10 ? "0" + x : "" + x; }
    return pad(d.getDate()) + "." + pad(d.getMonth() + 1) + "." + d.getFullYear();
  }

  function formatClock(d) {
    function pad(x) { return x < 10 ? "0" + x : "" + x; }
    return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
  }

  /* Fiyatın tazeliği: updatedAt'ten itibaren geçen süreye göre metin. */
  function freshnessInfo(updatedAt, nowMs, staleLimitMs) {
    var t = parseFloat(updatedAt);
    if (!isFinite(t) || t <= 0) {
      return { fresh: false, label: "Hiç veri gelmedi", ageMs: null };
    }
    var age = (nowMs || Date.now()) - t;
    if (age < 0) { age = 0; }
    var limit = staleLimitMs || 180000;
    var label;
    if (age < 15000) { label = "Canlı"; }
    else if (age < 60000) { label = Math.round(age / 1000) + " sn önce"; }
    else if (age < limit) { label = Math.round(age / 60000) + " dk önce"; }
    return {
      fresh: age < limit,
      label: age < limit ? label : "Güncel değil (" + Math.round(age / 60000) + " dk önce)",
      ageMs: age
    };
  }

  return {
    formatNumber: formatNumber,
    formatTL: formatTL,
    formatCurrencyTL: formatCurrencyTL,
    formatUSD: formatUSD,
    formatDateTime: formatDateTime,
    formatDate: formatDate,
    formatClock: formatClock,
    freshnessInfo: freshnessInfo
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = PriceFormatter;
}
