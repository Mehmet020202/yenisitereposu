/* GELISTIRME DOGRULAMA ARACI - Harem Socket.IO gercek semasini yakalar.
 * Kullanim: node probe.js  (tek seferlik kisitli sure, kullanim kosullarina
 * uyumlu: tek baglanti, kisa sure, sadece dinleme). */
"use strict";
const { io } = require("socket.io-client");

const URL = "https://socket.haremaltin.com";
const events = {};      // eventName -> ornek payload (ilk 2)
const samples = {};     // eventName -> [payload...]

function shape(x, depth) {
  depth = depth || 0;
  if (x === null) return "null";
  if (Array.isArray(x)) return "Array(" + x.length + ")" + (x.length && depth < 2 ? "[" + shape(x[0], depth + 1) + "]" : "");
  if (typeof x === "object") {
    if (depth >= 3) return "Obj{" + Object.keys(x).slice(0, 12).join(",") + "}";
    let s = "{";
    Object.keys(x).slice(0, 12).forEach((k) => { s += k + ":" + shape(x[k], depth + 1) + ","; });
    return s + "}";
  }
  return typeof x + "(" + String(x).substring(0, 24) + ")";
}

const socket = io(URL, {
  transports: ["websocket"],
  reconnection: false,
  timeout: 10000,
  forceNew: true
});

socket.on("connect", () => {
  console.log("CONNECTED id=" + socket.id);
  // Bircok Harem istemcisi 'subscribe' + sembol dizisi kullanir.
  socket.emit("subscribe", ["ALTIN", "USDTRY", "EURTRY"]);
  // Yedek varyantlar (hangi protokol kabul ediliyorsa veri akisi onu tetikler):
  setTimeout(() => { try { socket.emit("subscribe", { symbols: ["ALTIN", "USDTRY", "EURTRY"] }); } catch (e) {} }, 1500);
  setTimeout(() => { try { socket.emit("join", ["ALTIN", "USDTRY", "EURTRY"]); } catch (e) {} }, 3000);
  setTimeout(() => { try { socket.emit("sub", "ALTIN"); } catch (e) {} }, 4500);
});

socket.onAny((eventName, ...args) => {
  samples[eventName] = (samples[eventName] || []);
  if (samples[eventName].length < 3) samples[eventName].push(args[0]);
  events[eventName] = (events[eventName] || 0) + 1;
  // Sadece fiyatla ilgili veya ilk ornegini detayli bas
  if (samples[eventName].length <= 2) {
    console.log("EV[" + eventName + "] shape=" + shape(args[0]) +
      " raw=" + JSON.stringify(args[0]).substring(0, 400));
  }
});

socket.on("connect_error", (e) => console.log("CONNECT_ERROR " + e.message));
socket.on("disconnect", (r) => console.log("DISCONNECT " + r));

setTimeout(() => {
  console.log("\n==== OZET OLAY SAYILARI ====");
  Object.keys(events).forEach((k) => console.log(k + " : " + events[k]));
  console.log("\n==== ALTIN/USD/EUR OLAN OLAYLARIN ILK ORNEKLERI ====");
  Object.keys(samples).forEach((k) => {
    const s = JSON.stringify(samples[k][0] || {});
    if (/ALTIN|USD|EUR|alis|satis|aski|buy|sell|has|gram|cur/i.test(s) || /altin|usd|eur|price/i.test(k)) {
      console.log("--- " + k + " ---");
      console.log(s.substring(0, 800));
    }
  });
  try { socket.close(); } catch (e) {}
  process.exit(0);
}, 32000);
