const db = require("../db/db");
const emailService = require("../services/email.service");

async function postContact(req, res, next) {
  try {
    const { name, email, phone, reason, message } = req.body;
    const business = req.business;

    if (!name || !email || !message) {
      return res.status(400).json({ error: "name, email, and message are required." });
    }

    db.prepare(
      `INSERT INTO contact_messages (business_id, name, email, phone, reason, message) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(business.id, name, email, phone || null, reason || null, message);

    const emailResult = await emailService.sendContactNotification({ name, email, phone, reason, message });

    res.status(201).json({ success: true, emailSent: emailResult.sent });
  } catch (err) {
    next(err);
  }
}

module.exports = { postContact };
