/**
 * Onboard a new business onto the platform.
 *
 * Usage:
 *   node scripts/createBusiness.js
 *
 * Creates a row in the `businesses` table with a freshly generated API key.
 * That key is what the business's website widget AND their owner app both
 * send as the `X-API-Key` header on every request — it's how bookings and
 * chat sessions stay scoped to just their business.
 *
 * Edit the CONFIG object below for each new business you onboard, or turn
 * this into an interactive prompt / admin endpoint later.
 */
require("dotenv").config();
const crypto = require("crypto");
const businessesRepo = require("../src/db/businessesRepo");

const CONFIG = {
  id: "michigan-bar-grill", // slug, must be unique, lowercase-dashes
  name: "Michigan Bar & Grill",
  googleCalendarId: "your-banquet-hall-calendar-id@group.calendar.google.com",
  openHour: 9,
  closeHour: 20,
  closedDay: 1, // Monday
  restaurantInfo: {
    address: "1711 Walker Rd, Windsor, ON N8W 3P2, Canada",
    phone: "+1 519 252 9357",
    hours: "Tuesday to Sunday, 9:00am - 8:00pm. Closed Mondays.",
    about:
      "Michigan Bar & Grill is a Windsor, Ontario restaurant known for genuine Broaster chicken " +
      "(voted Best Chicken Restaurant in Windsor-Essex, Best of YQG 2021), hearty breakfasts, BBQ ribs, " +
      "steaks, burgers and fresh fish. It also has an elegant on-site banquet hall available for " +
      "weddings, milestone birthdays, and corporate events.",
    popularMenuItems: [
      { name: "Steak & Eggs", price: 17.99, desc: "2 eggs with N.Y. steak, home fries & toast" },
      { name: "Western Omelette", price: 13.99, desc: "Ham, green pepper, onions & cheese" },
      { name: "Mexican Omelette", price: 14.99, desc: "Green pepper, tomatoes, onions, cheese & chili" },
      { name: "Southern Chicken Salad", price: 14.99, desc: "Fried chicken, roasted peppers, cheese, croutons, veg, bacon" },
      { name: "BBQ Rib Plate", price: 15.99, desc: "Smaller portion of ribs with fries" },
      { name: "Chicken Souvlaki Dinner", price: 19.99, desc: "2 grilled skewers, Greek salad, pita, tzatziki, potato" },
      { name: "Halibut Fish N' Chips", price: 21.99, desc: "Golden fried, choice of potato & coleslaw" },
    ],
    specials: [
      { name: "1/2 Slab Ribs", price: 17.99, desc: "With coleslaw and choice of potatoes" },
      { name: "4-Piece Chicken (Dark Meat)", price: 14.99, desc: "With coleslaw and choice of potatoes" },
      { name: "Pork Chops", price: 18.99, desc: "With vegetables and choice of potatoes" },
      { name: "Perch", price: 19.99, desc: "With coleslaw and choice of potatoes" },
    ],
    banquetHall: {
      description:
        "An elegant, spacious banquet hall on-site, suited to weddings, milestone birthdays, " +
        "anniversaries and corporate events. Decor, linens, and layout can be tailored to the event.",
      bookingPolicy:
        "Banquet hall bookings require a proposed date, start time, end time (or event duration), " +
        "estimated guest count, and a contact name/phone/email. All bookings should be confirmed " +
        "against the calendar before being finalized, and the customer should be told a staff " +
        "member may follow up to confirm final details (catering, deposit, etc.).",
    },
  },
  // Structured, orderable menu — used by online ordering (cart, AI add_to_cart,
  // and Stripe checkout). Prices here are the ones actually charged — keep in
  // sync with your real menu. "id" must be a unique slug, no spaces.
  menuItems: [
    { id: "steak-eggs", name: "Steak & Eggs", price: 17.99 },
    { id: "western-omelette", name: "Western Omelette", price: 13.99 },
    { id: "mexican-omelette", name: "Mexican Omelette", price: 14.99 },
    { id: "southern-chicken-salad", name: "Southern Chicken Salad", price: 14.99 },
    { id: "bbq-rib-plate", name: "BBQ Rib Plate", price: 15.99 },
    { id: "chicken-souvlaki", name: "Chicken Souvlaki Dinner", price: 19.99 },
    { id: "halibut-fish-chips", name: "Halibut Fish N' Chips", price: 21.99 },
    { id: "half-slab-ribs", name: "1/2 Slab Ribs", price: 17.99 },
    { id: "chicken-dark-4pc", name: "4-Piece Chicken (Dark Meat)", price: 14.99 },
    { id: "pork-chops", name: "Pork Chops", price: 18.99 },
    { id: "perch", name: "Perch", price: 19.99 },
  ],
};

const apiKey = "biz_" + crypto.randomBytes(24).toString("hex");

try {
  const business = businessesRepo.create({ ...CONFIG, apiKey });
  console.log("\n✅ Business created:\n");
  console.log(`   ID:            ${business.id}`);
  console.log(`   Name:          ${business.name}`);
  console.log(`   API Key:       ${business.api_key}`);
  console.log(`   Calendar ID:   ${business.google_calendar_id}\n`);
  console.log("Give the API key to:");
  console.log("  - the website's chat widget / contact form config");
  console.log("  - the owner's iOS app, stored securely (e.g. Keychain) after their login\n");
} catch (err) {
  if (err.message.includes("UNIQUE")) {
    console.error(`A business with id "${CONFIG.id}" already exists. Change CONFIG.id and re-run.`);
  } else {
    console.error(err);
  }
  process.exit(1);
}
