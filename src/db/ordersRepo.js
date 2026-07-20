const db = require("./db");

function insertOrder({
  businessId,
  stripeSessionId,
  customerName,
  customerEmail,
  customerPhone,
  items,
  subtotalCents,
  status = "pending",
  source = "agent",
}) {
  const stmt = db.prepare(`
    INSERT INTO orders
      (business_id, stripe_session_id, customer_name, customer_email, customer_phone, items_json, subtotal_cents, status, source)
    VALUES (@businessId, @stripeSessionId, @customerName, @customerEmail, @customerPhone, @itemsJson, @subtotalCents, @status, @source)
  `);
  const info = stmt.run({
    businessId,
    stripeSessionId: stripeSessionId || null,
    customerName: customerName || null,
    customerEmail: customerEmail || null,
    customerPhone: customerPhone || null,
    itemsJson: JSON.stringify(items),
    subtotalCents,
    status,
    source,
  });
  return info.lastInsertRowid;
}

function markPaidBySessionId(stripeSessionId) {
  db.prepare(
    `UPDATE orders SET status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE stripe_session_id = ?`
  ).run(stripeSessionId);
}

function markCompleted(orderId, businessId) {
  db.prepare(
    `UPDATE orders SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND business_id = ?`
  ).run(orderId, businessId);
}

function getByStripeSessionId(stripeSessionId) {
  return db.prepare(`SELECT * FROM orders WHERE stripe_session_id = ?`).get(stripeSessionId);
}

/**
 * Powers the app's two tabs: "Orders" (active = paid, not yet completed)
 * and "Previous Orders" (completed). Pending/unpaid carts are excluded
 * from both — they only become a real order once Stripe confirms payment.
 */
function listOrders(businessId, { activeOnly, previousOnly } = {}) {
  if (activeOnly) {
    return db
      .prepare(`SELECT * FROM orders WHERE business_id = ? AND status = 'paid' ORDER BY created_at DESC`)
      .all(businessId);
  }
  if (previousOnly) {
    return db
      .prepare(`SELECT * FROM orders WHERE business_id = ? AND status = 'completed' ORDER BY created_at DESC`)
      .all(businessId);
  }
  return db
    .prepare(`SELECT * FROM orders WHERE business_id = ? ORDER BY created_at DESC`)
    .all(businessId);
}

module.exports = { insertOrder, markPaidBySessionId, markCompleted, getByStripeSessionId, listOrders };
