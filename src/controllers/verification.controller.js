const verificationRepo = require("../db/verificationRepo");
const emailService = require("../services/email.service");

function isValidEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * POST /api/verification/send
 * Generates a 6-digit code, stores it, and emails it to the given
 * address. Called when someone starts signing up (business or employee),
 * before their real account exists anywhere.
 */
async function postSend(req, res, next) {
  try {
    const { email } = req.body;
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "A valid email is required." });
    }

    // Simple cooldown — don't allow spamming the same email with resends.
    const existing = verificationRepo.getLatestForEmail(email);
    if (existing) {
      const secondsSinceLast = (Date.now() - new Date(existing.created_at + "Z").getTime()) / 1000;
      if (secondsSinceLast < 45) {
        return res.status(429).json({ error: "Please wait a moment before requesting another code." });
      }
    }

    const { code } = verificationRepo.insertCode(email);
    const result = await emailService.sendVerificationCode({ email, code });

    res.json({ sent: result.sent });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/verification/confirm
 * Checks the code the user typed in against the most recent one sent to
 * that email. Marks it verified on success so signup can proceed.
 */
async function postConfirm(req, res, next) {
  try {
    const { email, code } = req.body;
    if (!isValidEmail(email) || !code) {
      return res.status(400).json({ error: "email and code are required." });
    }

    const row = verificationRepo.getLatestForEmail(email);
    if (!row) {
      return res.status(400).json({ error: "No verification code found for this email. Please request a new one." });
    }
    if (row.attempts >= 5) {
      return res.status(429).json({ error: "Too many incorrect attempts. Please request a new code." });
    }
    if (new Date(row.expires_at + "Z").getTime() < Date.now()) {
      return res.status(400).json({ error: "That code has expired. Please request a new one." });
    }
    if (row.code !== String(code).trim()) {
      verificationRepo.incrementAttempts(row.id);
      return res.status(400).json({ error: "Incorrect code. Please try again." });
    }

    verificationRepo.markVerified(row.id);
    res.json({ verified: true });
  } catch (err) {
    next(err);
  }
}

module.exports = { postSend, postConfirm };
