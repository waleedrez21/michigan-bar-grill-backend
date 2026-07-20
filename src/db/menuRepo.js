const businessesRepo = require("./businessesRepo");

/**
 * Returns the structured, orderable menu items for a business:
 * [{ id, name, price, category }, ...]  (price is in dollars, e.g. 13.99)
 */
function getMenuItems(business) {
  try {
    return JSON.parse(business.menu_items_json || "[]");
  } catch (e) {
    return [];
  }
}

function findMenuItem(business, itemId) {
  return getMenuItems(business).find((i) => i.id === itemId);
}

/**
 * Validates a cart against the REAL menu/prices stored server-side —
 * never trust an id/price/quantity sent from the browser or the AI as-is.
 * Returns { valid: [...], invalid: [...] }.
 */
function resolveCartItems(business, requestedItems) {
  const menu = getMenuItems(business);
  const valid = [];
  const invalid = [];

  for (const req of requestedItems) {
    const menuItem = menu.find((m) => m.id === req.id);
    const quantity = Math.max(1, parseInt(req.quantity, 10) || 1);
    if (!menuItem) {
      invalid.push({ id: req.id, reason: "Item not found on menu" });
      continue;
    }
    valid.push({
      id: menuItem.id,
      name: menuItem.name,
      price: menuItem.price, // dollars — authoritative, from our own DB
      quantity,
    });
  }

  return { valid, invalid };
}

module.exports = { getMenuItems, findMenuItem, resolveCartItems };
