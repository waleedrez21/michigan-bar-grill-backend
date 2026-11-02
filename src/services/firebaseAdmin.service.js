const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

function ensureInitialized() {
  if (getApps().length > 0) return;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not set.");
  }

  const serviceAccount = JSON.parse(raw);
  initializeApp({
    credential: cert(serviceAccount),
  });
}

/** Updates a Firebase user's password by their email address. */
async function updatePasswordByEmail(email, newPassword) {
  ensureInitialized();
  const auth = getAuth();
  const user = await auth.getUserByEmail(email);
  await auth.updateUser(user.uid, { password: newPassword });
}

async function verifyIdToken(token) {
  ensureInitialized();
  return getAuth().verifyIdToken(token, true);
}
async function legacyMemberships(businessId) {
  ensureInitialized();
  const { getFirestore } = require('firebase-admin/firestore');
  const snapshot = await getFirestore().collection('memberships').where('businessId', '==', businessId).get();
  return snapshot.docs.map(doc => doc.data());
}
async function userEmail(uid) {
  ensureInitialized();
  return (await getAuth().getUser(uid)).email;
}
module.exports = { updatePasswordByEmail, verifyIdToken, legacyMemberships, userEmail };
