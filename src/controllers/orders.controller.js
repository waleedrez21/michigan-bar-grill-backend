const menuRepo = require("../db/menuRepo");
const ordersRepo = require("../db/ordersRepo");
const stripeService = require("../services/stripe.service");

function getMenu(req, res) {
  res.json(menuRepo.getMenuItems(req.business));
}

async function postCheckout(req, res, next) {
  try {
    const business = req.business;
    const { items, customerName, customerEmail, customerPhone } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "`items` must be a non-empty array of { id, quantity }." });
    }

    const { valid, invalid } = menuRepo.resolveCartItems(business, items);
    if (invalid.length > 0) {
      return res.status(400).json({ error: "Some items are not on the menu.", invalid });
    }

    const subtotalCents = valid.reduce((sum, i) => sum + Math.round(i.price * 100) * i.quantity, 0);

    // Create the order as 'pending' first — it only flips to 'paid' once
    // Stripe's webhook confirms the payment actually went through.
    const orderId = ordersRepo.insertOrder({
      businessId: business.id,
      customerName,
      customerEmail,
      customerPhone,
      items: valid,
      subtotalCents,
      status: "pending",
      source: req.body.source || "website",
    });

    const session = await stripeService.createCheckoutSession({
      business,
      cartItems: valid,
      customerEmail,
      orderId,
    });

    // Attach the Stripe session id to the order so the webhook can find it.
    const db = require("../db/db");
    db.prepare(`UPDATE orders SET stripe_session_id = ? WHERE id = ?`).run(session.id, orderId);

    res.json({ checkoutUrl: session.url, orderId });
  } catch (err) {
    next(err);
  }
}

function listOrders(req, res, next) {
  try {
    const { status } = req.query; // 'active' | 'previous' | undefined
    const options =
      status === "active" ? { activeOnly: true } : status === "previous" ? { previousOnly: true } : {};
    res.json(ordersRepo.listOrders(req.business.id, options));
  } catch (err) {
    next(err);
  }
}

function completeOrder(req, res, next) {
  try {
    ordersRepo.markCompleted(req.params.id, req.business.id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/orders/by-session/:sessionId
 * Used by the order-success.html page after Stripe redirects back — looks
 * up the order that was just paid for, so the page can show a real
 * summary instead of a generic "thanks!" message.
 */
function getBySession(req, res, next) {
  try {
    const order = ordersRepo.getByStripeSessionId(req.params.sessionId);

    // Scope check: never return an order that belongs to a different
    // business, even if someone guesses/reuses a session id.
    if (!order || order.business_id !== req.business.id) {
      return res.status(404).json({ error: "Order not found." });
    }

    res.json({
      id: order.id,
      customerName: order.customer_name,
      customerPhone: order.customer_phone,
      items: JSON.parse(order.items_json),
      subtotal: order.subtotal_cents / 100,
      status: order.status,
      createdAt: order.created_at,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getMenu, postCheckout, listOrders, completeOrder, getBySession };
