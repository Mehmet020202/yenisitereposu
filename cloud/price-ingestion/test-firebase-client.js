"use strict";

const assert = require("assert");
const firebase = require("firebase");
const writer = require("./firebase-writer");

async function main() {
  const required = [
    "FB_PROJECT_ID",
    "FB_CLIENT_EMAIL",
    "FB_PRIVATE_KEY",
    "FB_DATABASE_URL",
    "FB_API_KEY"
  ];
  const previous = {};
  required.forEach((name) => {
    previous[name] = process.env[name];
    delete process.env[name];
  });
  try {
    assert.throws(writer.validateConfig, /Eksik Firebase yapılandırması/);
    console.log("PASS missing Firebase configuration is reported");
  } finally {
    required.forEach((name) => {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    });
  }

  const app = firebase.initializeApp({
    apiKey: "test-api-key",
    databaseURL: "https://writer-api-check.firebaseio.com"
  }, "writer-api-check-" + process.pid);

  try {
    assert.strictEqual(typeof app.auth().signInWithCustomToken, "function");
    assert.strictEqual(typeof app.database().ref, "function");
    assert.strictEqual(typeof app.database().ref().update, "function");
    console.log("PASS Firebase 8 custom-token and Realtime Database client APIs");
  } finally {
    await app.delete();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
