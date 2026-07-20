const Stripe = require("stripe");

let stripeClient = null;
function getStripeClient() {
  if (stripeClient) return stripeClient;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set. See .env.example for setup instructions.");
  }
  stripeClient = new Stripe(key);
  return stripeClient;
}

/**
 * Creates a Stripe Checkout Session — a Stripe-hosted payment page.
 * `cartItems` must already be resolved/validated against the real menu
 * (see menuRepo.resolveCartItems) — prices here are trusted as real.
 */
async function createCheckoutSession({ business, cartItems, customerEmail, orderId }) {
  const stripe = getStripeClient();

  const successUrl = process.env.STRIPE_SUCCESS_URL || "https://example.com/order-success.html";
  const cancelUrl = process.env.STRIPE_CANCEL_URL || "https://example.com/order-cancelled.html";

  const line_items = cartItems.map((item) => ({
    price_data: {
      currency: "cad",
      product_data: { name: item.name },
      unit_amount: Math.round(item.price * 100), // Stripe wants cents
    },
    quantity: item.quantity,
  }));

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items,
    success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl,
    customer_email: customerEmail || undefined,
    metadata: {
      businessId: business.id,
      orderId: String(orderId),
    },
  });

  return session; // session.id, session.url
}

/**
 * Verifies a webhook request actually came from Stripe (not a forged
 * request) using the raw request body + signature header + your webhook
 * signing secret. Throws if invalid.
 */
function constructWebhookEvent(rawBody, signature) {
  const stripe = getStripeClient();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not set. See .env.example for setup instructions.");
  }
  return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
}

module.exports = { createCheckoutSession, constructWebhookEvent };
