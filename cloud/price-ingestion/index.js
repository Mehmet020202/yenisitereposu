/* =====================================================================
 * ALTUĞ KUYUMCULUK - Bulut Fiyat Toplama Hizmeti (ana giriş)
 * =====================================================================
 * Cloud Run (yönetilen, sürekli çalışan konteyner) içinde çalışır.
 * Kulanicinin bilgisayariyla HICBIR ilgisi yoktur; PC kapaliyken de
 * fiyat cekmeye devam eder.
 *
 * Akis:
 *   Harem Socket.IO "price_changed" -> haritalama -> dogrulama ->
 *   Firebase marketPrices + connectionStatus
 *
 * DAYANIKLILIK:
 *   - Otomatik yeniden baglanma (socket.io-client varsayilanlari + backoff)
 *   - Baglanti koparsa connectionStatus'a "harem: disconnected" yazilir
 *   - Baglanti acik gorunup 5 dk gecerli fiyat gelmezse socket yenilenir
 *   - Gecersiz veri son gecerli fiyatin UZERINE YAZILMAZ
 *   - Her 60 sn'de heartbeat (sonSeen) yazilir
 *
 * CLOUD RUN NOTU: Konteyner 8080 portunda saglik kontrolu sunmak zorundadir
 * (Cloud Run zorunlulugu). Bu yuzden hafif bir HTTP sunucusu acilir; asıl
 * isi Socket.IO akisi yapar.
 * ===================================================================== */

"use strict";

const http = require("http");
const { io } = require("socket.io-client");
const { mapPriceMessage, validateFieldPair } = require("./harem-map");
const fb = require("./firebase-writer");

fb.validateConfig();

const HAREM_URL = process.env.HAREM_SOCKET_URL || "https://socket.haremaltin.com";
const SYMBOLS = (process.env.HAREM_SYMBOLS || "ALTIN,USDTRY,EURTRY").split(",");
const MAX_JUMP = parseFloat(process.env.MAX_JUMP_RATIO || "0.30");
const PORT = parseInt(process.env.PORT || "8080", 10);

/* In-memory son gecerli piyasa (previous degerler sıçrama kontrolü için) */
let lastGood = {};
let lastMessageAt = 0;
let lastMarketTime = 0;
let socketState = "connecting";
let haremSocket = null;
let lastSilenceReconnectAt = 0;
let silenceReconnectDelayMs = 5 * 60 * 1000;

const server = http.createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      socket: socketState,
      lastMessageAt: lastMessageAt,
      lastGood: lastGood
    }));
  } else {
    res.writeHead(404); res.end();
  }
});
server.listen(PORT, () => console.log("health server on :" + PORT));

async function flushPartial(partial, serverTime) {
  const accepted = {};
  let rejectedCount = 0;
  const keys = Object.keys(partial);
  for (const key of keys) {
    const res = validateFieldPair(key, partial[key], lastGood[key], MAX_JUMP);
    if (res.ok) {
      accepted[key] = res.value;
    } else {
      rejectedCount++;
      console.warn("REJECTED " + res.reason);
    }
  }
  if (Object.keys(accepted).length > 0) {
    try {
      await fb.writeMarketPrices(accepted, serverTime);
      Object.assign(lastGood, accepted);
      console.log("WROTE " + JSON.stringify(accepted) +
        (serverTime ? " @" + serverTime : ""));
    } catch (e) {
      console.error("Firebase yazim hatasi: " + e.message);
    }
  }
  return rejectedCount;
}

function connectHarem() {
  if (haremSocket) return;
  console.log("Harem'e baglaniliyor: " + HAREM_URL);
  const socket = io(HAREM_URL, {
    transports: ["websocket"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 30000,
    timeout: 15000
  });
  haremSocket = socket;

  socket.on("connect", async () => {
    if (haremSocket !== socket) return;
    socketState = "connected";
    lastMessageAt = Date.now();
    console.log("Baglandi. ID=" + socket.id);
    /* CANLI DOGRULAMA (2026-11-03): Sunucu baglanti aninda 'price_changed'
     * olayini KENDILIGINDEN yayar (abonelik sart degil). Asagidaki emit'ler
     * zararsiz en-iyi-demesik katmandir; HAREM_SUBSCRIBE_PROTOCOL=none ile
     * kapatilabilir. */
    const proto = process.env.HAREM_SUBSCRIBE_PROTOCOL || "none";
    if (proto === "subscribe-array") {
      socket.emit("subscribe", SYMBOLS);
    } else if (proto === "subscribe-object") {
      socket.emit("subscribe", { symbols: SYMBOLS });
    } else if (proto === "join") {
      socket.emit("join", SYMBOLS);
    }
    try {
      await fb.writeConnectionStatus({ harem: "connected", note: "socket baglantisi aktif" });
    } catch (e) { console.error("status yazilamadi: " + e.message); }
  });

  socket.on("disconnect", async (reason) => {
    if (haremSocket !== socket) return;
    socketState = "disconnected";
    console.warn("Baglantı koptu: " + reason);
    try {
      await fb.writeConnectionStatus({ harem: "disconnected", note: "kopma: " + reason });
    } catch (e) { console.error("disconnect status yazilamadi: " + e.message); }
  });

  socket.on("connect_error", async (err) => {
    if (haremSocket !== socket) return;
    socketState = "error";
    console.warn("Baglanti hatasi: " + err.message);
    try {
      await fb.writeConnectionStatus({ harem: "error", note: err.message });
    } catch (e) { console.error("connect_error status yazilamadi: " + e.message); }
  });

  /* Bilinen olay adları; farklıysa logdan gerçek şemayı göreceğiz. */
  socket.on("price_changed", (data) => handlePrice(data, "price_changed"));
  socket.on("price", (data) => handlePrice(data, "price"));
  socket.onAny((eventName, ...args) => {
    /* price/price_changed yukarida isleniyor; tekrar islemeyiz. */
    if (eventName === "price_changed" || eventName === "price") { return; }
    /* Bilinmeyen olayları ilk dakikalarda şemayı öğrenmek için logla. */
    if (eventName.indexOf("price") !== -1) {
      handlePrice(args[0], eventName);
    } else {
      console.log("OLAY " + eventName + " :: " + safeJson(args[0]).substring(0, 300));
    }
  });
}

function reconnectAfterSilence() {
  if (!haremSocket || socketState !== "connected") return;
  const now = Date.now();
  if (!HaremMap.isFeedSilent(lastSilenceReconnectAt, now, silenceReconnectDelayMs)) return;

  lastSilenceReconnectAt = now;
  silenceReconnectDelayMs = Math.min(silenceReconnectDelayMs * 2, 30 * 60 * 1000);
  const previousSocket = haremSocket;
  haremSocket = null;
  socketState = "reconnecting";
  console.warn("Fiyat akisinda 5 dk sessizlik; Harem baglantisi yenileniyor");
  previousSocket.disconnect();
  setTimeout(() => {
    if (!haremSocket) connectHarem();
  }, 1000);
}

/* CANLI DOGRULANMIS sema (probe 2026-11-03):
 *   { meta: { time: <ms> }, data: { ALTIN:{alis,satis,...}, USDTRY:{...},
 *     EURTRY:{...}, CEYREK_YENI:{...}, ... } }
 * Eski/bilesim varyantlari da (data Without sarmalayici, tek-sembol {symbol,...})
 * geride birakilr, boylece sunucu protokol degistirirse cod cokmez. */
function handlePrice(data, via) {
  if (!data || typeof data !== "object") return;
  const receivedAt = Date.now();

  /* meta.time'i ancak alis saatiyle uyumluysa kullan; altı saatlik saat
   * sapmasi canli olayi eski veri gibi reddetmemeli. */
  var serverTime = HaremMap.normalizeMarketTime(
    data.meta && data.meta.time, receivedAt, 180000
  );

  /* Sembol haritasi: dogru yer data.data altindadir. */
  var symRoot = (data.data && typeof data.data === "object") ? data.data : data;
  var merged = {};

  /* Biçim A (dogrulanmis): { SEMBOL: {alis,satis} , ... } */
  for (const symbol of Object.keys(symRoot)) {
    const rec = symRoot[symbol];
    if (rec && typeof rec === "object") {
      const m = mapPriceMessage(symbol, rec);
      if (m) merged = Object.assign(merged, m);
    }
  }
  /* Biçim B (yedek): { symbol: "ALTIN", alis, satis } */
  if (Object.keys(merged).length === 0 && data.symbol) {
    const m = mapPriceMessage(data.symbol, data);
    if (m) merged = m;
  }

  if (Object.keys(merged).length > 0) {
    if (serverTime && lastMarketTime && serverTime < lastMarketTime) {
      console.warn("OLD_EVENT ignored @" + serverTime + " < " + lastMarketTime);
      return;
    }
    lastMessageAt = receivedAt;
    lastSilenceReconnectAt = 0;
    silenceReconnectDelayMs = 5 * 60 * 1000;
    if (serverTime) lastMarketTime = Math.max(lastMarketTime, serverTime);
    flushPartial(merged, serverTime).catch((e) => console.error(e.message));
  } else {
    console.log("ESLESMEYEN veri (" + via + "): " + safeJson(data).substring(0, 300));
  }
}

function safeJson(x) { try { return JSON.stringify(x); } catch (e) { return String(x); } }

/* Heartbeat: 60 sn'de bir durum tazeleme. 5 dk boyunca tek bir mesaj bile
 * gelmediyse yöneticiyi uyaran "stale" durumu yazilir. */
setInterval(async () => {
  const now = Date.now();
  try {
    if (socketState !== "connected") {
      await fb.writeConnectionStatus({ harem: socketState, note: "yeniden baglanma denemeleri suruyor" });
    } else if (HaremMap.isFeedSilent(lastMessageAt, now, 5 * 60 * 1000)) {
      reconnectAfterSilence();
      await fb.writeConnectionStatus({ harem: "stale", note: "5 dk+ veri akisi yok" });
    } else {
      await fb.writeConnectionStatus({ harem: "connected", note: "kalp atisi" });
    }
  } catch (e) { console.error("heartbeat hatasi: " + e.message); }
}, 60000);

/* Baslangic: once Firebase'deki son gecerli degerleri previous olarak yukle */
(async function start() {
  try {
    lastGood = await fb.readCurrentMarket();
    const storedMarketTime = Number(lastGood.marketTime ||
      (lastGood.source === "harem" ? lastGood.updatedAt : 0));
    if (Number.isFinite(storedMarketTime) && storedMarketTime > 0) {
      lastMarketTime = storedMarketTime;
    }
    console.log("Previous yuklendi: " + safeJson(lastGood).substring(0, 200));
  } catch (e) {
    console.error("Previous okunamadi (ilk calisma olabilir): " + e.message);
  }
  connectHarem();
})();

process.on("unhandledRejection", (e) => console.error("unhandledRejection", e));
