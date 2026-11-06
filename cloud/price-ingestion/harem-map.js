/* =====================================================================
 * ALTUĞ KUYUMCULUK - Harem Altın Socket.IO Alan Haritalama ve Doğrulama
 * (Node.js 18+, bulut konteyneri içinde çalışır; kullanıcı PC'sinde DEĞİL)
 *
 * DİKKAT: Beklenen alan adları (ALTIN.alis/satis vb.) başlangıç
 * varsayımıdır. Gerçek mesaj yapısı canlı bağlantıyla DOĞRULANMALIDIR.
 * unknownKeys günlüğü, ilk çalıştırmada gerçek şemayı görmek için tutulur.
 * ===================================================================== */

"use strict";

/* SCHEMA VERIFIED by live Socket.IO probe on 2026-11-03:
 * price_changed -> { meta:{time}, data:{ ALTIN|USDTRY|EURTRY: {alis, satis, dir:{alis_dir, satis_dir}, ...} } }
 * Values may be string ("50.0700") or number; toNumber handles both.
 * dir.alis_dir / dir.satis_dir yon bilgisi tasir ("up"/"down"); TV'de ok olarak gosterilir. */
const FIELD_MAP = {
  ALTIN: { buy: "alis", sell: "satis", targetBuy: "hasBuy", targetSell: "hasSell",
    targetBuyDir: "hasBuyDir", targetSellDir: "hasSellDir" },
  USDTRY: { buy: "alis", sell: "satis", targetBuy: "usdBuy", targetSell: "usdSell",
    targetBuyDir: "usdBuyDir", targetSellDir: "usdSellDir" },
  EURTRY: { buy: "alis", sell: "satis", targetBuy: "eurBuy", targetSell: "eurSell",
    targetBuyDir: "eurBuyDir", targetSellDir: "eurSellDir" }
};

function toNumber(raw) {
  if (typeof raw === "number") return raw;
  if (typeof raw !== "string") return NaN;
  let s = raw.replace(/\s/g, "");
  if (s === "") return NaN;
  if (s.indexOf(",") > -1 && s.indexOf(".") > -1) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.indexOf(",") > -1) {
    s = s.replace(",", ".");
  }
  const n = parseFloat(s);
  return isFinite(n) ? n : NaN;
}

/* Tek bir price_changed kaydı -> { hasBuy..eurSell } kısmi nesnesi.
 * Eşleşme yoksa null döner (bilinmeyen sembol sessizce yoksayılır). */
function mapPriceMessage(symbol, payload) {
  const map = FIELD_MAP[symbol];
  if (!map || !payload || typeof payload !== "object") return null;
  const buy = toNumber(payload[map.buy]);
  const sell = toNumber(payload[map.sell]);
  const out = {};
  let found = false;
  if (isFinite(buy)) { out[map.targetBuy] = buy; found = true; }
  if (isFinite(sell)) { out[map.targetSell] = sell; found = true; }
  /* Yon bilgisi (dir): yalnizca bilinen degerler kaydedilir. */
  if (payload.dir && typeof payload.dir === "object") {
    if (payload.dir.alis_dir === "up" || payload.dir.alis_dir === "down") {
      out[map.targetBuyDir] = payload.dir.alis_dir;
    }
    if (payload.dir.satis_dir === "up" || payload.dir.satis_dir === "down") {
      out[map.targetSellDir] = payload.dir.satis_dir;
    }
  }
  return found ? out : null;
}

/* Doğrulama: boş/sıfır/negatif/NaN/Infinity/ani sıçrama. */
function validateFieldPair(field, value, previous, maxJumpRatio) {
  /* Yon alanlari (hasBuyDir vb.) sayi degil; up/down beyazi kabul edilir. */
  if (/Dir$/.test(field)) {
    return (value === "up" || value === "down")
      ? { ok: true, value: value }
      : { ok: false, reason: field + ": gecersiz yon degeri" };
  }
  if (typeof value !== "number" || isNaN(value)) {
    return { ok: false, reason: field + ": NaN veya bos" };
  }
  if (!isFinite(value)) return { ok: false, reason: field + ": Infinity" };
  if (value <= 0) return { ok: false, reason: field + ": sifir/negatif" };
  const prev = toNumber(previous);
  if (isFinite(prev) && prev > 0) {
    const ratio = Math.abs(value - prev) / prev;
    if (ratio > maxJumpRatio) {
      return { ok: false, reason: field + ": olagan dışi sıçrama %" + Math.round(ratio * 100) };
    }
  }
  return { ok: true, value: value };
}

module.exports = { FIELD_MAP, toNumber, mapPriceMessage, validateFieldPair };
