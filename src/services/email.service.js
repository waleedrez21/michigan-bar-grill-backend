const nodemailer = require("nodemailer");

function isConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_PORT === "465",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

async function sendContactNotification({ name, email, phone, reason, message }) {
  if (!isConfigured()) {
    console.log("[email] SMTP not configured — skipping send, message was still saved to DB.");
    return { sent: false };
  }

  const transporter = getTransporter();
  await transporter.sendMail({
    from: `"Michigan Bar & Grill Website" <${process.env.SMTP_USER}>`,
    to: process.env.CONTACT_TO_EMAIL || process.env.SMTP_USER,
    replyTo: email,
    subject: `New website enquiry: ${reason || "General"} — ${name}`,
    text: `Name: ${name}\nEmail: ${email}\nPhone: ${phone || "n/a"}\nReason: ${reason || "n/a"}\n\n${message}`,
  });

  return { sent: true };
}

async function sendVerificationCode({ email, code }) {
  if (!isConfigured()) {
    console.log("[email] SMTP not configured — skipping send. Code was still generated:", code);
    return { sent: false };
  }

  const transporter = getTransporter();
  await transporter.sendMail({
    from: `"Work Bay" <${process.env.SMTP_USER}>`,
    to: email,
    subject: `Your Work Bay verification code: ${code}`,
    text: `Your verification code is ${code}. It expires in 10 minutes.\n\nIf you didn't request this, you can ignore this email.`,
  });

  return { sent: true };
}

module.exports = { sendContactNotification, sendVerificationCode, isConfigured };
