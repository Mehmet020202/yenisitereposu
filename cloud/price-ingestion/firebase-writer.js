/* =====================================================================
 * ALTUĞ KUYUMCULUK - Firebase Yazıcı Modülü (Node.js, bulut konteyneri)
 * =====================================================================
 * - Firebase servis hesabı bilgileriyle custom token üretir.
 * - firebase@8 SDK'sı + custom token ile "ingest-service" kimliği
 *   altına bağlanır. Security Rules'da marketPrices ve connectionStatus
 *   yalnızca bu kimliğe yazma izni verir.
 * - websockets-only transport: Node ortamında XHR/JSONP yoktur.
 * ===================================================================== */

"use strict";

const { initializeApp: initializeAdmin, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const firebase = require("firebase");

let adminReady = false;
let firebaseApp = null;
let dbRef = null;
let dbConnectPromise = null;

const APP_NAME = "price-ingestion";

function validateConfig() {
  const required = [
    "FB_PROJECT_ID",
    "FB_CLIENT_EMAIL",
    "FB_PRIVATE_KEY",
    "FB_DATABASE_URL",
    "FB_API_KEY"
  ];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error("Eksik Firebase yapılandırması: " + missing.join(", "));
  }
}

function ensureAdmin() {
  if (adminReady) return;
  validateConfig();
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

/* Firebase client SDK ile bağlanır; Security Rules ingest-service UID'sini denetler. */
function connectDb() {
  if (dbRef) return Promise.resolve(dbRef);
  if (dbConnectPromise) return dbConnectPromise;

  dbConnectPromise = (async () => {
    validateConfig();
    const url = process.env.FB_DATABASE_URL;
    const apiKey = process.env.FB_API_KEY;
    const token = await mintIngestToken();
    if (!firebaseApp) {
      firebaseApp = firebase.initializeApp({
        apiKey,
        databaseURL: url,
        projectId: process.env.FB_PROJECT_ID
      }, APP_NAME);
    }
    await firebaseApp.auth().signInWithCustomToken(token);
    dbRef = firebaseApp.database().ref();
    return dbRef;
  })().catch((err) => {
    dbConnectPromise = null;
    throw err;
  });

  return dbConnectPromise;
}

/* Doğrulanmış ham fiyatları ve bağlantı durumunu yazar.
 * Sadece değişen alanlar gönderilir (update semantics).
 * updatedAt: alım zamanı; marketTime: varsa Harem meta.time (ms). */
async function writeMarketPrices(partial, serverTime) {
  const root = await connectDb();
  const receivedAt = Date.now();
  const marketTime = (typeof serverTime === "number" && isFinite(serverTime) && serverTime > 0)
    ? serverTime : receivedAt;
  const payload = Object.assign({}, partial, {
    updatedAt: receivedAt,
    marketTime,
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
  validateConfig,
  connectDb,
  writeMarketPrices,
  writeConnectionStatus,
  readCurrentMarket
};
