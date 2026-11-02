const firebase = require('../services/firebaseAdmin.service');

async function requireFirebaseUser(req, res, next) {
  const match = /^Bearer (.+)$/i.exec(req.get('Authorization') || '');
  if (!match) return res.status(401).json({ error: 'Please sign in to your WorkBay account.' });
  try {
    req.user = await firebase.verifyIdToken(match[1]);
    next();
  } catch (error) {
    if (error.message === 'FIREBASE_SERVICE_ACCOUNT_JSON is not set.') {
      return res.status(503).json({ error: 'Account services are temporarily unavailable.' });
    }
    return res.status(401).json({ error: 'Your session expired. Please sign in again.' });
  }
}
module.exports = requireFirebaseUser;
