const verificationRepo = require("../db/verificationRepo");
const firebaseAdmin = require("../services/firebaseAdmin.service");

function isValidPassword(password) {
  if (typeof password !== "string" || password.length < 6) return false;
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[!@#$%^&*()]/.test(password);
  const hasLetter = /[a-zA-Z]/.test(password);
  return hasNumber && hasSpecial && hasLetter;
}

/**
 * POST /api/auth/reset-password
 * Only succeeds if this email has a recently-confirmed verification code
 * (see verificationRepo.hasRecentVerification) — reuses the same
 * send/confirm flow as signup, so there's no separate "reset code" system
 * to maintain.
 */
async function postResetPassword(req, res, next) {
  try {
    const { email, newPassword } = req.body;

    if (!email || !newPassword) {
      return res.status(400).json({ error: "email and newPassword are required." });
    }
    if (!isValidPassword(newPassword)) {
      return res.status(400).json({ error: "Password must have 6+ characters, a letter, a number, and a special character." });
    }
    if (!verificationRepo.hasRecentVerification(email)) {
      return res.status(400).json({ error: "Please verify your email with a code before resetting your password." });
    }

    await firebaseAdmin.updatePasswordByEmail(email, newPassword);
    res.json({ success: true });
  } catch (err) {
    if (err.code === "auth/user-not-found") {
      return res.status(404).json({ error: "No account found with that email." });
    }
    next(err);
  }
}

module.exports = { postResetPassword };
