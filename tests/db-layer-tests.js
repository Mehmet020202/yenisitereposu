"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "../public/js/db.js"), "utf8");

function createHarness(responses, user, enableEventSource) {
  const requests = [];
  const timers = [];
  const streams = [];

  function FakeXhr() {
    this.readyState = 0;
    this.status = 0;
    this.responseText = "";
    requests.push(this);
  }
  FakeXhr.prototype.open = function (method, url) {
    this.method = method;
    this.url = url;
  };
  FakeXhr.prototype.setRequestHeader = function () {};
  FakeXhr.prototype.send = function () {
    const response = responses.shift();
    if (!response) { throw new Error("No mocked XHR response"); }
    this.status = response.status;
    this.responseText = response.body || "";
    this.readyState = 4;
    this.onreadystatechange();
  };
  function FakeEventSource(url) {
    this.url = url;
    this.listeners = {};
    this.closed = false;
    streams.push(this);
  }
  FakeEventSource.prototype.addEventListener = function (name, handler) {
    this.listeners[name] = handler;
  };
  FakeEventSource.prototype.close = function () { this.closed = true; };
  FakeEventSource.prototype.dispatch = function (name, data) {
    if (this.listeners[name]) { this.listeners[name]({ data: JSON.stringify(data) }); }
  };
  FakeEventSource.prototype.onerror = null;

  const window = {
    APP_CONFIG: { firebase: { apiKey: "public-test-key", databaseURL: "https://example.test" } },
    localStorage: { getItem: function () { return null; }, setItem: function () {} },
    console: { warn: function () {} }
  };
  if (enableEventSource) { window.EventSource = FakeEventSource; }
  if (user) {
    window.firebase = {
      apps: [],
      initializeApp: function () { this.apps.push({}); },
      auth: function () { return { currentUser: user }; },
      database: function () {
        return { ref: function () { return { on: function () {} }; } };
      }
    };
  }
  const context = {
    window: window,
    XMLHttpRequest: FakeXhr,
    setTimeout: function (fn, delay) {
      const timer = { fn: fn, delay: delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout: function (timer) { if (timer) { timer.cleared = true; } },
    setInterval: function () { return 1; },
    clearInterval: function () {},
    console: window.console,
    JSON: JSON,
    Math: Math,
    Date: Date,
    String: String,
    Error: Error,
    encodeURIComponent: encodeURIComponent,
    isFinite: isFinite
  };
  vm.runInNewContext(source, context);
  return { db: context.AppDb, requests: requests, timers: timers, streams: streams };
}

async function run() {
  let passed = 0;

  const failedNetwork = createHarness([{ status: 0 }]);
  const networkResult = await new Promise(function (resolve) {
    failedNetwork.db.restGet("marketPrices", function (value, error) {
      resolve({ value: value, error: error });
    });
  });
  assert.strictEqual(networkResult.value, null);
  assert.ok(networkResult.error);
  assert.ok(/HTTP 0/.test(networkResult.error.message));
  passed++;

  const tokenCalls = [];
  const authHarness = createHarness([
    { status: 401, body: '{"error":"expired"}' },
    { status: 200, body: '{"hasBuy":5600}' }
  ], {
    getIdToken: function (forceRefresh) {
      tokenCalls.push(forceRefresh === true);
      return Promise.resolve(forceRefresh ? "fresh-token" : "old-token");
    }
  });
  authHarness.db.init();
  const authResult = await new Promise(function (resolve) {
    authHarness.db.restGet("marketPrices", function (value, error) {
      resolve({ value: value, error: error });
    });
  });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(authResult.value)), { hasBuy: 5600 });
  assert.strictEqual(authResult.error, null);
  assert.deepStrictEqual(tokenCalls, [false, true]);
  assert.ok(/old-token/.test(authHarness.requests[0].url));
  assert.ok(/fresh-token/.test(authHarness.requests[1].url));
  passed++;

  const writeTokenCalls = [];
  const writeHarness = createHarness([
    { status: 401, body: '{"error":"expired"}' },
    { status: 200, body: '{"name":"new-key"}' }
  ], {
    getIdToken: function (forceRefresh) {
      writeTokenCalls.push(forceRefresh === true);
      return Promise.resolve(forceRefresh ? "fresh-token" : "old-token");
    }
  });
  writeHarness.db.init();
  const writeResult = await new Promise(function (resolve) {
    writeHarness.db.set("products", { name: "Test" }, function (error, value) {
      resolve({ error: error, value: value });
    });
  });
  assert.strictEqual(writeResult.error, null);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(writeResult.value)), { name: "new-key" });
  assert.deepStrictEqual(writeTokenCalls, [false, true]);
  assert.ok(/old-token/.test(writeHarness.requests[0].url));
  assert.ok(/fresh-token/.test(writeHarness.requests[1].url));
  passed++;

  const pollHarness = createHarness([
    { status: 200, body: '{"hasBuy":5600}' },
    { status: 0 }
  ]);
  const updates = [];
  const stop = pollHarness.db.poll("marketPrices", function (value, error) {
    updates.push({ value: value, error: error });
  }, 100);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(updates[0].value)), { hasBuy: 5600 });
  assert.strictEqual(updates[0].error, null);
  assert.strictEqual(pollHarness.timers[0].delay, 100);
  pollHarness.timers[0].fn();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(updates[1].value)), { hasBuy: 5600 });
  assert.ok(updates[1].error);
  assert.strictEqual(pollHarness.timers[1].delay, 200);
  stop();
  passed++;

  const streamHarness = createHarness([], {
    getIdToken: function (forceRefresh) {
      return Promise.resolve(forceRefresh ? "fresh-stream-token" : "stream-token");
    }
  }, true);
  streamHarness.db.init();
  const streamUpdates = [];
  const stopStream = streamHarness.db.subscribe("marketPrices", function (value, error) {
    streamUpdates.push({ value: value, error: error });
  }, 100);
  await Promise.resolve();
  await Promise.resolve();
  assert.strictEqual(streamHarness.streams.length, 1);
  assert.ok(/auth=stream-token/.test(streamHarness.streams[0].url));
  streamHarness.streams[0].dispatch("put", {
    path: "/", data: { hasBuy: 5600, hasSell: 5620 }
  });
  streamHarness.streams[0].dispatch("patch", {
    path: "/", data: { hasBuy: 5601 }
  });
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(streamUpdates[1].value)),
    { hasBuy: 5601, hasSell: 5620 }
  );
  assert.strictEqual(streamUpdates[1].error, null);
  stopStream();
  assert.strictEqual(streamHarness.streams[0].closed, true);
  passed++;

  const refreshedStreamTokens = [];
  const refreshStreamHarness = createHarness([], {
    getIdToken: function (forceRefresh) {
      refreshedStreamTokens.push(forceRefresh === true);
      return Promise.resolve(forceRefresh ? "rotated-stream-token" : "expired-stream-token");
    }
  }, true);
  refreshStreamHarness.db.init();
  const stopRefreshedStream = refreshStreamHarness.db.subscribe("products", function () {});
  await Promise.resolve();
  await Promise.resolve();
  refreshStreamHarness.streams[0].dispatch("auth_revoked", { error: "expired" });
  await Promise.resolve();
  await Promise.resolve();
  assert.strictEqual(refreshStreamHarness.streams.length, 2);
  assert.ok(/auth=rotated-stream-token/.test(refreshStreamHarness.streams[1].url));
  assert.deepStrictEqual(refreshedStreamTokens, [false, false, true]);
  stopRefreshedStream();
  passed++;

  const fallbackHarness = createHarness([
    { status: 200, body: '{"hasBuy":5600}' }
  ], null, true);
  const fallbackUpdates = [];
  const stopFallback = fallbackHarness.db.subscribe("marketPrices", function (value) {
    fallbackUpdates.push(value);
  }, 100);
  fallbackHarness.streams[0].onerror();
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(fallbackUpdates[0])),
    { hasBuy: 5600 }
  );
  stopFallback();
  passed++;

  const legacyHarness = createHarness([
    { status: 200, body: '{"currencySectionHidden":false}' }
  ]);
  const legacyValues = [];
  const stopLegacy = legacyHarness.db.subscribe("settings", function (value) {
    legacyValues.push(value);
  }, 100);
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(legacyValues[0])),
    { currencySectionHidden: false }
  );
  assert.strictEqual(legacyHarness.timers[0].delay, 100);
  stopLegacy();
  passed++;

  const cappedHarness = createHarness([
    { status: 200, body: '{"ready":true}' }
  ], null, true);
  const cappedStops = [];
  for (let i = 0; i < 6; i++) {
    cappedStops.push(cappedHarness.db.subscribe("node" + i, function () {}, 100));
  }
  assert.strictEqual(cappedHarness.streams.length, 5);
  assert.strictEqual(cappedHarness.requests.length, 1);
  cappedStops.forEach(function (stopSubscription) { stopSubscription(); });
  passed++;

  console.log("PASS  HTTP 0 is reported as a network error");
  console.log("PASS  GET retries one 401 with a refreshed token");
  console.log("PASS  Writes retry one 401 with a refreshed token");
  console.log("PASS  Poll keeps its last value and backs off after failure");
  console.log("PASS  Realtime SSE applies puts and patches with an admin token");
  console.log("PASS  SSE refreshes expired admin tokens");
  console.log("PASS  SSE errors fall back to REST polling");
  console.log("PASS  Browsers without EventSource use REST polling");
  console.log("PASS  RTDB SSE connections stay under the browser limit");
  console.log("\nTOPLAM: " + passed + " database katmani testi gecti.");
}

run().catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
