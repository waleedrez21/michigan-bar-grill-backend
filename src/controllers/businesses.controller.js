const crypto = require("crypto");
const businessesRepo = require("../db/businessesRepo");

function generateApiKey() {
  return "biz_" + crypto.randomBytes(24).toString("hex");
}

/** Short, human-friendly code like "MBG-4821" — first 3 letters from the
 *  business name (padded/truncated), plus 4 random digits. Retries on the
 *  rare collision since `code` is UNIQUE in the database. */
function generateBusinessCode(name) {
  const prefixSource = (name || "BIZ").replace(/[^a-zA-Z]/g, "").toUpperCase();
  const prefix = (prefixSource + "XXX").slice(0, 3);
  const digits = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${digits}`;
}

function slugify(name) {
  const base = (name || "business")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  const suffix = crypto.randomBytes(3).toString("hex");
  return `${base || "business"}-${suffix}`;
}

/** Blank-but-safe defaults so the chat agent and app don't crash for a
 *  brand-new business that hasn't filled in its real info yet. */
function defaultRestaurantInfo(name) {
  return {
    address: "Address not yet set",
    phone: "Phone not yet set",
    hours: "Hours not yet set",
    about: `${name} is new to the platform — details coming soon.`,
    popularMenuItems: [],
    specials: [],
    banquetHall: {
      description: "Banquet hall details not yet set.",
      bookingPolicy: "Contact the business directly to book.",
    },
  };
}

/**
 * POST /api/businesses/signup
 * Creates a brand-new, empty business record — no menu, no orders, no
 * bookings — and returns its API key + code so the app can start using it
 * immediately. Called right after Firebase account creation succeeds.
 */
async function postSignup(req, res, next) {
  try {
    const { businessName } = req.body;
    if (!businessName || typeof businessName !== "string" || !businessName.trim()) {
      return res.status(400).json({ error: "`businessName` (string) is required." });
    }

    let code = req.body.code;
    // If the app didn't pass a pre-generated code, or it's already taken,
    // generate a fresh one server-side (retry a few times on collision).
    for (let i = 0; i < 5; i++) {
      if (code && !businessesRepo.getByCode(code)) break;
      code = generateBusinessCode(businessName);
    }

    const id = slugify(businessName);
    const apiKey = generateApiKey();

    const business = businessesRepo.create({
      id,
      name: businessName.trim(),
      apiKey,
      googleCalendarId: "", // not yet configured — set up later via settings
      restaurantInfo: defaultRestaurantInfo(businessName.trim()),
      menuItems: [],
      code,
    });

    res.status(201).json({
      businessId: business.id,
      businessName: business.name,
      apiKey: business.api_key,
      code: business.code,
    });
  } catch (err) {
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE" || err.code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
      return res.status(409).json({ error: "That business could not be created — please try again." });
    }
    next(err);
  }
}

/**
 * GET /api/businesses/by-code/:code
 * Used by the login screen — a returning user (or an employee joining)
 * enters their business code, and the app exchanges it for the real API
 * key to use for all further requests.
 */
async function getByCode(req, res, next) {
  try {
    const { code } = req.params;
    const business = businessesRepo.getByCode(code);
    if (!business) {
      return res.status(404).json({ error: "No business found with that code." });
    }
    res.json({
      businessId: business.id,
      businessName: business.name,
      apiKey: business.api_key,
      code: business.code,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { postSignup, getByCode };
