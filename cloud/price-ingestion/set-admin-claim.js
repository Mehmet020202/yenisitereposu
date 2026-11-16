"use strict";

const { initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getDatabase } = require("firebase-admin/database");

async function main() {
  const uid = process.argv[2];
  if (!uid) {
    throw new Error("Usage: node set-admin-claim.js <firebase-auth-uid>");
  }
  const projectId = process.env.FB_PROJECT_ID;
  const databaseURL = process.env.FB_DATABASE_URL;
  const clientEmail = process.env.FB_CLIENT_EMAIL;
  const privateKey = (process.env.FB_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!projectId || !databaseURL || !clientEmail || !privateKey) {
    throw new Error("FB_PROJECT_ID, FB_DATABASE_URL, FB_CLIENT_EMAIL and FB_PRIVATE_KEY are required");
  }

  const app = initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
    databaseURL
  });
  const auth = getAuth(app);
  const rootAdmin = await getDatabase(app).ref("admins/rootAdminUid").once("value");
  if (rootAdmin.val() !== uid) {
    throw new Error("The requested UID does not match admins/rootAdminUid");
  }
  const user = await auth.getUser(uid);
  await auth.setCustomUserClaims(uid, Object.assign({}, user.customClaims || {}, { admin: true }));
  console.log("Storage admin claim set for UID " + uid + ". Sign in again to refresh the ID token.");
}

main().catch((error) => {
  console.error("Could not set Storage admin claim: " + error.message);
  process.exitCode = 1;
});
