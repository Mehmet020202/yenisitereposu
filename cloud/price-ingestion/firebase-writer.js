/* =====================================================================
 * ALTUĞ KUYUMCULUK - Firebase Yazıcı Modülü (Node.js, bulut konteyneri)
 * =====================================================================
 * - Servis hesabı (GOOGLE_APPLICATION_CREDENTIALS) ile custom token üretir.
 * - Eski firebase@8 SDK'sı + custom token ile "ingest-service" kimliği
 *   altına bağlanır. Security Rules'da marketPrices ve connectionStatus
 *   yalnızca bu kimliğe yazma izni verir.
 * - websockets-only transport: Node ortamında XHR/JSONP yoktur.
 * ===================================================================== */

"use strict";

const { initializeApp: initializeAdmin, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const Firebase = require("firebase"); // firebase@8.10.x (eski API, Node desteği)

let adminReady = false;
let dbRef = null;

function ensureAdmin() {
  if (adminReady) return;
  initializeAdmin({
    credential: cert({
      projectId: process.env.FB_PROJECT_ID,
      clientEmail: process.env.FB_CLIENT_EMAIL,
      privateKey: (process.env.FB_PRIVATE_KEY || "").replace(/\\n/g, "\n")
    })
  });
  adminReady = true;
}

/* "ingest-service" sabit UID'si ile custom token üretir.
 * auth.uid == 'ingest-service' kuralı bu token'ı doğrular. */
async function mintIngestToken() {
  ensureAdmin();
  return getAuth().createCustomToken("ingest-service", { role: "ingest" });
}

/* Eski SDK ile veritabanına bağlanır ve kök referansı döndürür. */
async function connectDb() {
  if (dbRef) return dbRef;
  const url = process.env.FB_DATABASE_URL;
  if (!url) throw new Error("FB_DATABASE_URL tanimli degil");
  const token = await mintIngestToken();
  const root = new Firebase(url);
  await new Promise((resolve, reject) => {
    root.authWithCustomToken(token, (err, authData) => {
      if (err) reject(err); else resolve(authData);
    });
  });
  dbRef = root;
  return root;
}

/* Doğrulanmış ham fiyatları ve bağlantı durumunu yazar.
 * Sadece değişen alanlar gönderilir (update semantics).
 * serverTime: Harem meta.time (ms) - varsa gerçek piyasa zamani kullanilir. */
async function writeMarketPrices(partial, serverTime) {
  const root = await connectDb();
  const ts = (typeof serverTime === "number" && isFinite(serverTime) && serverTime > 0)
    ? serverTime : Date.now();
  const payload = Object.assign({}, partial, {
    updatedAt: ts,
    source: "harem"
  });
  await new Promise((resolve, reject) => {
    root.child("marketPrices").update(payload, (err) => {
      if (err) reject(err); else resolve();
    });
  });
}

async function writeConnectionStatus(state) {
  const root = await connectDb();
  const payload = Object.assign({ at: Date.now() }, state);
  await new Promise((resolve, reject) => {
    root.child("connectionStatus").set(payload, (err) => {
      if (err) reject(err); else resolve();
    });
  });
}

/* Son yazılmış değerleri oku (sıçrama doğrulaması için "previous"). */
async function readCurrentMarket() {
  const root = await connectDb();
  return new Promise((resolve, reject) => {
    root.child("marketPrices").once("value", (snap) => {
      if (snap && snap.val()) resolve(snap.val()); else resolve({});
    }, reject);
  });
}

module.exports = {
  connectDb,
  writeMarketPrices,
  writeConnectionStatus,
  readCurrentMarket
};
