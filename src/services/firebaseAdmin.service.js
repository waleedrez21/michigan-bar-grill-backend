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

async function sendPush(token,notification,data){
  ensureInitialized();
  const {getMessaging}=require('firebase-admin/messaging');
  try{
    await getMessaging().send({token,notification,data,apns:{headers:{'apns-priority':'10'},payload:{aps:{sound:'default'}}}});
    return {sent:true};
  }catch(error){
    if(['messaging/registration-token-not-registered','messaging/invalid-registration-token'].includes(error.code))return {sent:false,invalid:true};
    throw error;
  }
}
module.exports.sendPush=sendPush;

async function deleteAccountData(uid,email){
 ensureInitialized();
 const firestore=require('firebase-admin/firestore').getFirestore();
 const employees=await firestore.collection('employees').where('ownerID','==',uid).get();
 const docs=new Map();
 const collect=async(collection,field,value)=>{
  const snapshot=await firestore.collection(collection).where(field,'==',value).get();
  for(const doc of snapshot.docs)docs.set(doc.ref.path,doc.ref);
 };
 for(const collection of ['memberships','activeSessions','clockSessions']){
  await collect(collection,'uid',uid);await collect(collection,'ownerID',uid);
 }
 for(const doc of employees.docs){
  docs.set(doc.ref.path,doc.ref);
  const code=doc.data().employeeCode;
  if(typeof code==='string'){
   await collect('activeSessions','employeeCode',code);
   await collect('clockSessions','employeeCode',code);
  }
 }
 const references=[...docs.values()];
 for(let offset=0;offset<references.length;offset+=400){const batch=firestore.batch();references.slice(offset,offset+400).forEach(ref=>batch.delete(ref));await batch.commit();}
}
async function revokeUser(uid){ensureInitialized();try{await getAuth().revokeRefreshTokens(uid);}catch(e){if(e.code!=='auth/user-not-found')throw e;}}
async function deleteUser(uid){ensureInitialized();try{await getAuth().deleteUser(uid);}catch(e){if(e.code!=='auth/user-not-found')throw e;}}
module.exports.deleteAccountData=deleteAccountData;
module.exports.revokeUser=revokeUser;
module.exports.deleteUser=deleteUser;

async function markEmailVerified(uid){ensureInitialized();await getAuth().updateUser(uid,{emailVerified:true});}
module.exports.markEmailVerified=markEmailVerified;
