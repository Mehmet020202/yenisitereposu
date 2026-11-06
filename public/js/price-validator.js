/* =====================================================================
 * ALTUĞ KUYUMCULUK - Fiyat Doğrulama Motoru (ES5, eski tarayıcı uyumlu)
 * =====================================================================
 * Harem'den (veya bulut hizmetinden) gelen ham fiyatlar BU KATMANDAN
 * geçmeden veritabanına yazılmaz ve ekranda kullanılmaz.
 *
 * Kontrol edilenler:
 *  - Bos / tanimsiz deger
 *  - Sifir ve negatif deger
 *  - NaN / Infinity
 *  - Beklenmeyen veri tipi (string sayilar kabul edilir, virgül çevrilir)
 *  - Eksik sembol
 *  - Ani ve olagan dışi fiyat degisimi (maxJumpRatio)
 *  - Eski veri (tazelik kontrolü çağıran tarafta yapılır)
 * ===================================================================== */

var PriceValidator = (function () {
  "use strict";

  /* "5.600,00" / "5600.00" / 5600 gibi girdileri tek bir sayıya çevirir.
   * Başarısızsa NaN döndürür. */
  function toNumber(raw) {
    if (typeof raw === "number") { return raw; }
    if (typeof raw !== "string") { return NaN; }
    var s = raw.replace(/\s/g, "");
    if (s === "") { return NaN; }
    /* Türkçe biçim: 5.600,00 -> 5600.00 */
    if (s.indexOf(",") > -1 && s.indexOf(".") > -1) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else if (s.indexOf(",") > -1) {
      /* Sadece virgül varsa: onayırımı kabul et (50,10 -> 50.10).
       * Binlik ayırıcı olarak kullanılan "5,600" biçimi desteklenmez;
       * Harem noktalandırmada onayırımı virgülle verir. */
      s = s.replace(",", ".");
    } else if (s.indexOf(".") > -1) {
      /* Sadece nokta: binlik ayırıcı mı onayırımı mı?
       * Birden çok nokta varsa binlik ayırıcıdır (1.234.567). */
      var parts = s.split(".");
      if (parts.length > 2) { s = parts.join(""); }
    }
    var n = parseFloat(s);
    return isFinite(n) ? n : NaN;
  }

  /* Tek bir fiyat değeri + önceki değeriyle sıçrama kontrolü.
   * Sonuç: { ok: true, value: number } ya da { ok: false, reason: string } */
  function validatePrice(raw, previous, maxJumpRatio) {
    var value = toNumber(raw);
    if (typeof raw === "undefined" || raw === null || raw === "") {
      return { ok: false, reason: "Bos deger" };
    }
    if (isNaN(value)) { return { ok: false, reason: "Sayi degil (NaN)" }; }
    if (!isFinite(value)) { return { ok: false, reason: "Infinity" }; }
    if (value <= 0) { return { ok: false, reason: "Sifir veya negatif" }; }

    var prev = toNumber(previous);
    if (typeof maxJumpRatio !== "number" || maxJumpRatio <= 0) {
      maxJumpRatio = 0.30;
    }
    if (isFinite(prev) && prev > 0) {
      var ratio = Math.abs(value - prev) / prev;
      if (ratio > maxJumpRatio) {
        return { ok: false, reason: "Olagan dışi sıçrama (%" +
          Math.round(ratio * 100) + ")" };
      }
    }
    return { ok: true, value: value };
  }

  /* Altı alanın tamamı birlikte doğrulanır. Eksik sembol / alan tespiti. */
  function validateMarketPayload(data, previous, maxJumpRatio) {
    var required = ["hasBuy", "hasSell", "usdBuy", "usdSell", "eurBuy", "eurSell"];
    var out = { ok: true, values: {}, errors: {} };
    var i, key, res;
    if (!data || typeof data !== "object") {
      return { ok: false, values: {}, errors: { _payload: "Payload bos veya obje degil" } };
    }
    for (i = 0; i < required.length; i++) {
      key = required[i];
      if (!(key in data) || data[key] === null || typeof data[key] === "undefined") {
        out.errors[key] = "Eksik alan";
        out.ok = false;
        continue;
      }
      res = validatePrice(data[key], previous ? previous[key] : null, maxJumpRatio);
      if (res.ok) {
        out.values[key] = res.value;
      } else {
        out.errors[key] = res.reason;
        out.ok = false;
      }
    }
    return out;
  }

  return {
    toNumber: toNumber,
    validatePrice: validatePrice,
    validateMarketPayload: validateMarketPayload
  };
})();

/* Node.js test ortamı için modül dışa aktarımı (tarayıcıda etkisizdir) */
if (typeof module !== "undefined" && module.exports) {
  module.exports = PriceValidator;
}
