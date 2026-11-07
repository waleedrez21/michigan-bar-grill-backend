const stripeService = require("../services/stripe.service");
const ordersRepo = require("../db/ordersRepo");

async function handleStripeWebhook(req, res, next) {
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

  if (["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type)) {
    const session = event.data.object;
    if (session.payment_status === "paid") {
      let order;
      try {
        order = ordersRepo.markPaidBySessionId(session.id);
      } catch (err) {
        return next(err);
      }
      // Only the request that advances the order from unpaid can send an alarm.
      if (order) {
        try {
          await require("../services/orderAlerts.service").pushNewOrder(order, session);
        } catch (err) {
          console.error("[order push] Delivery failed for order", order.id);
        }
      }
    }
  }

  res.json({ received: true });
}

module.exports = { handleStripeWebhook };
