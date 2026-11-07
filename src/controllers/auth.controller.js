// Legacy email-only password changes are intentionally disabled.
// New clients use Firebase Auth sendPasswordReset; Firebase validates and
// consumes its single-use action code on the hosted reset page.
function postResetPassword(req, res) {
  res.status(410).json({error: 'Update WorkBay and use the password reset email link. This legacy reset method is disabled.'});
}
module.exports = { postResetPassword };
