const db = require("../db/db");
const firebase = require("./firebaseAdmin.service");

async function pushNewOrder(order, session) {
  const tokens = db.prepare(`
    SELECT DISTINCT token FROM push_tokens
    JOIN business_members ON business_members.uid = push_tokens.uid
    WHERE business_members.business_id = ?
  `).all(order.business_id);
  const items = JSON.parse(order.items_json)
    .map(item => `${item.quantity}x ${item.name}`).join(", ");
  const total = new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: (session.currency || "cad").toUpperCase(),
  }).format((session.amount_total ?? order.subtotal_cents) / 100);
  const body = [ "New order", total, items ].filter(Boolean).join(" — ").slice(0, 240);
  const data = { businessId: order.business_id, orderId: String(order.id) };
  const results = await Promise.allSettled(tokens.map(async ({ token }) => {
    const result = await firebase.sendPush(token, { title: "WorkBay", body }, data);
    if (result.invalid) db.prepare("DELETE FROM push_tokens WHERE token = ?").run(token);
    else if (!result.sent) throw new Error("Push was not sent");
  }));
  if (results.some(result => result.status === "rejected")) {
    console.error("[order push] Some devices did not receive order", order.id);
  }
}

module.exports = { pushNewOrder };
