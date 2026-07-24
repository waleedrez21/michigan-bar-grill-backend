const { Resend } = require("resend");

function isConfigured() {
  return !!process.env.RESEND_API_KEY;
}

function getClient() {
  return new Resend(process.env.RESEND_API_KEY);
}

// Resend requires a verified domain to send to arbitrary recipients.
// Until michiganbarandgrill.org is verified in Resend's dashboard, this
// default only successfully delivers to the email address the Resend
// account itself was signed up with — fine for testing, not for real
// signups. See the domain verification steps mentioned in chat.
const FROM_ADDRESS = process.env.EMAIL_FROM || "Work Bay <onboarding@resend.dev>";

async function sendContactNotification({ name, email, phone, reason, message }) {
  if (!isConfigured()) {
    console.log("[email] RESEND_API_KEY not set — skipping send, message was still saved to DB.");
    return { sent: false };
  }

  const resend = getClient();
  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: process.env.CONTACT_TO_EMAIL,
    replyTo: email,
    subject: `New website enquiry: ${reason || "General"} — ${name}`,
    text: `Name: ${name}\nEmail: ${email}\nPhone: ${phone || "n/a"}\nReason: ${reason || "n/a"}\n\n${message}`,
  });

  if (error) {
    console.error("[email] Resend error (contact):", error);
    return { sent: false };
  }
  return { sent: true };
}

async function sendVerificationCode({ email, code }) {
  if (!isConfigured()) {
    console.log("[email] RESEND_API_KEY not set — skipping send. Code was still generated:", code);
    return { sent: false };
  }

  const resend = getClient();
  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: email,
    subject: `Your Work Bay verification code: ${code}`,
    text: `Your verification code is ${code}. It expires in 10 minutes.\n\nIf you didn't request this, you can ignore this email.`,
  });

  if (error) {
    console.error("[email] Resend error (verification):", error);
    return { sent: false };
  }
  return { sent: true };
}

module.exports = { sendContactNotification, sendVerificationCode, isConfigured };
