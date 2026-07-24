const admin = require("firebase-admin");

let initialized = false;

function ensureInitialized() {
  if (initialized) return;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not set.");
  }

  const serviceAccount = JSON.parse(raw);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  initialized = true;
}

/** Updates a Firebase user's password by their email address. */
async function updatePasswordByEmail(email, newPassword) {
  ensureInitialized();
  const user = await admin.auth().getUserByEmail(email);
  await admin.auth().updateUser(user.uid, { password: newPassword });
}

module.exports = { updatePasswordByEmail };
