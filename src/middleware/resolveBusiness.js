const businessesRepo = require("../db/businessesRepo");

/**
 * Every request (from the website widget, the AI agent, or the owner's app)
 * must identify which business it belongs to via the X-API-Key header.
 * This keeps bookings, chat sessions, and menu info fully isolated per business.
 */
function resolveBusiness(req, res, next) {
  const apiKey = req.header("X-API-Key");

  if (!apiKey) {
    return res.status(401).json({ error: "Missing X-API-Key header." });
  }

  const business = businessesRepo.getByApiKey(apiKey);
  if (!business) {
    return res.status(401).json({ error: "Invalid API key." });
  }

  req.business = business;
  next();
}

function resolvePublicBusiness(req, res, next) {
  const businessId = req.get("X-WorkBay-Business");
  if (!businessId) return resolveBusiness(req, res, next);

  // The restaurant's public website can select this tenant on public routes.
  // Staff routes continue to require credentials and business membership.
  const business = businessId === "michigan-bar-grill" && businessesRepo.getById(businessId);
  if (!business) return res.status(404).json({ error: "Public business not found." });

  req.business = business;
  next();
}

module.exports = resolveBusiness;
module.exports.resolvePublicBusiness = resolvePublicBusiness;
