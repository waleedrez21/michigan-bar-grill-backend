const stripeService = require("../services/stripe.service");
const ordersRepo = require("../db/ordersRepo");

async function handleStripeWebhook(req, res) {
  const signature = req.headers["stripe-signature"];

  let event;
  try {
    // req.body here is the RAW Buffer (see app.js — this route is mounted
    // with express.raw(), not express.json()) — required for Stripe's
    // signature verification to work.
    event = stripeService.constructWebhookEvent(req.body, signature);
  } catch (err) {
    console.error("[stripe webhook] Signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    ordersRepo.markPaidBySessionId(session.id);
    console.log(`[stripe webhook] Order paid — session ${session.id}`);
  }

  // Always 200 quickly so Stripe doesn't keep retrying — even for event
  // types we don't act on.
  res.json({ received: true });
}

module.exports = { handleStripeWebhook };
