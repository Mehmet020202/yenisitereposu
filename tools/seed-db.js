/* =====================================================================
 * ALTUG KUYUMCULUK - Baslangic Verisi Tohumlama (yalnizca gelistirme)
 * Kullanim: node tools/seed-db.js
 * Firebase Console'dan "Open test mode" ile kurallar HENUZ DAGITILMAMISKEN
 * calisir (REST yazmasi aciktir). Kurallar dagitildiktan sonra bu betik
 * calismaz; tohumlama Admin panelindeki "Baslangic Verileri" butonu ile
 * yapilmalidir (giris yapmis admin yazabilir).
 * Piyasa degerleri: canli Harem probe'undan dogrulanan gercek formattadir.
 * ===================================================================== */
"use strict";

var https = require("https");

var DB_URL = "https://fiyat-listesi-70102-default-rtdb.europe-west1.firebasedatabase.app";
var NOW = Date.now();

/* Canli probe'dan dogrulanan semasi ile birebir piyasa verisi (ornek). */
var marketPrices = {
  hasBuy: 6369.49, hasSell: 6391.27,
  usdBuy: 50.07, usdSell: 50.15,
  eurBuy: 55.853, eurSell: 56.005,
  updatedAt: NOW,
  source: "harem"
};

var settings = {
  goldReference: "has_buy",
  goldDisplayMode: "both",
  currencyDisplayMode: "both",
  usdShowMode: "both",
  eurShowMode: "both",
  showUsd: true,
  showEur: true
};

var PRODUCTS = [
  ["HAS ALTIN", 1.00, 1.02],
  ["Gram Altın", 1.00, 1.05],
  ["22 Ayar", 0.90, 0.94],
  ["18 Ayar", 0.74, 0.78],
  ["14 Ayar", 0.56, 0.62],
  ["Çeyrek Altın", 6.42, 6.60],
  ["Yarım Altın", 12.84, 13.20],
  ["Tam Altın", 25.44, 26.00],
  ["Ata Altın", 26.40, 27.60],
  ["Gremse Altın", 31.80, 32.50],
  ["22 Ayar Bilezik", 0.88, 0.92]
];

var products = {};
for (var i = 0; i < PRODUCTS.length; i++) {
  var key = "seed" + (i + 1 < 10 ? "0" + (i + 1) : (i + 1));
  products[key] = {
    name: PRODUCTS[i][0],
    buyMultiplier: PRODUCTS[i][1],
    sellMultiplier: PRODUCTS[i][2],
    active: true, tvVisible: true, archived: false,
    order: i + 1, createdAt: NOW, updatedAt: NOW
  };
}

var data = {
  "marketPrices": marketPrices,
  "settings": settings,
  "products": products,
  "currencyAdjustments": {
    usdBuyAdjustment: 0, usdSellAdjustment: 0,
    eurBuyAdjustment: 0, eurSellAdjustment: 0
  },
  "branding": { name: "ALTUĞ KUYUMCULUK", logoUrl: "" },
  "advertisements": {
    ad1: {
      /* tv.js/admin.js semasi: title/description/durationSec (text/durationMs DEĞİL) */
      title: "ALTUĞ KUYUMCULUK",
      description: "Altuğ Kuyumculuk'a hoş geldiniz — güncel altın, dolar ve euro fiyatları.",
      imageUrl: "", active: true, order: 1, durationSec: 8
    }
  },
  "connectionStatus": {
    /* Bulut hizmetinin (cloud/price-ingestion) yazdigi semayla BİREBİR aynı:
     * tv.js renderLiveDot ve admin.js renderConn 'harem' alanini okur. */
    harem: "connected",
    note: "tools/seed-db.js ile yazildi (ornek veri)",
    at: NOW
  }
};

function put(path, body) {
  return new Promise(function (resolve, reject) {
    var json = JSON.stringify(body);
    var req = https.request(DB_URL + "/" + path + ".json", {
      method: "PUT",
      headers: { "Content-Type": "application/json" }
    }, function (res) {
      var b = "";
      res.on("data", function (d) { b += d; });
      res.on("end", function () {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(path + " -> OK (" + res.statusCode + ")");
        } else {
          reject(new Error(path + " -> FAIL " + res.statusCode + ": " + b.substring(0, 200)));
        }
      });
    });
    req.on("error", reject);
    req.write(json);
    req.end();
  });
}

(async function () {
  var keys = Object.keys(data);
  for (var k = 0; k < keys.length; k++) {
    try {
      console.log(await put(keys[k], data[keys[k]]));
    } catch (e) {
      console.error(e.message);
      console.error(">> Kural dagitilmis olabilir; Admin panelindeki tohumlama butonunu kullanin.");
      process.exit(1);
    }
  }
  console.log("Tum baslangic verisi yazildi. Okuma doglamasi:");
  var v = await new Promise(function (resolve) {
    https.get(DB_URL + "/marketPrices.json", function (res) {
      var b = ""; res.on("data", function (d) { b += d; });
      res.on("end", function () { resolve(b); });
    });
  });
  console.log("marketPrices geri okundu: " + v);
})();
