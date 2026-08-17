// One-time setup script — creates King Chicken as a real business on the
// shared backend, with a full menu and restaurant info, so the AI chat
// assistant can answer real questions and add real items to cart.
//
// Run this ONCE via Railway's Console tab (or locally against the same
// DB): node scripts/setupKingChicken.js
//
// It prints the business's API key + code at the end — copy the API key
// into js/chat-widget.js and js/cart.js on the King Chicken site.

const crypto = require("crypto");
const businessesRepo = require("../src/db/businessesRepo");

function generateApiKey() {
  return "biz_" + crypto.randomBytes(24).toString("hex");
}

const restaurantInfo = {
  address: "3249 Wyoming Ave, Dearborn, MI 48120",
  phone: "(313) 768-5464",
  hours: "Open daily, 10am–8pm (Monday through Sunday)",
  about:
    "King Chicken serves the best Yemeni-style fried chicken in Dearborn — crispy bowls, sandwiches, combo plates, and signature rolls, all made fresh to order.",
  popularMenuItems: [
    { name: "Crispy Shrimp Bowl", price: 11.99, desc: "Crispy fried shrimp over rice or fries, finished with our signature drizzle." },
    { name: "Chicken Strips Bowl", price: 9.99, desc: "Crispy chicken strips over rice or fries — small $5.99, large $9.99." },
    { name: "Nashville Hot Tenders Bowl", price: 9.99, desc: "Spicy Nashville hot tenders over rice or fries." },
    { name: "Chicken Biryani Bowl", price: 9.99, desc: "Fragrant biryani rice topped with crispy chicken." },
    { name: "Crispy Pizza Roll", price: 9.99, desc: "Crispy breaded roll stuffed with melted cheese and pizza sauce." },
    { name: "Zinger Burger", price: 9.99, desc: "Spicy crispy chicken burger, King Chicken style." },
  ],
  specials: [
    { name: "Crispy Cheese Nashville", price: 9.99, desc: "Nashville hot with a crispy cheese center." },
    { name: "Baked Chicken Roll", price: 9.99, desc: "Oven-baked chicken roll, golden and crispy." },
    { name: "Crispy Chicken Roll", price: 9.99, desc: "Crispy fried chicken roll, King Chicken signature." },
  ],
  // Reused for catering info (King Chicken doesn't have a banquet hall,
  // but the AI's instructions read this field for "private events/catering"
  // style questions).
  banquetHall: {
    description: "King Chicken caters for parties, events, and large orders — Yemeni-style fried chicken, bowls, and combo platters for any group size.",
    bookingPolicy: "Call (313) 768-5464 to discuss catering for your event — our team will help build a package for your group.",
  },
};

const menuItems = [
  // Bowls
  { id: "chicken-strips-bowl-sm", name: "Chicken Strips Bowl (Small)", price: 5.99, category: "Bowls" },
  { id: "chicken-strips-bowl-lg", name: "Chicken Strips Bowl (Large)", price: 9.99, category: "Bowls" },
  { id: "chicken-tenders-bowl-sm", name: "Chicken Tenders Bowl (Small)", price: 5.99, category: "Bowls" },
  { id: "chicken-tenders-bowl-lg", name: "Chicken Tenders Bowl (Large)", price: 9.99, category: "Bowls" },
  { id: "nashville-tenders-bowl-sm", name: "Nashville Hot Tenders Bowl (Small)", price: 5.99, category: "Bowls" },
  { id: "nashville-tenders-bowl-lg", name: "Nashville Hot Tenders Bowl (Large)", price: 9.99, category: "Bowls" },
  { id: "chicken-biryani-bowl-sm", name: "Chicken Biryani Bowl (Small)", price: 5.99, category: "Bowls" },
  { id: "chicken-biryani-bowl-lg", name: "Chicken Biryani Bowl (Large)", price: 9.99, category: "Bowls" },
  { id: "crispy-shrimp-bowl", name: "Crispy Shrimp Bowl", price: 11.99, category: "Bowls" },
  { id: "golden-fish-bowl", name: "Golden Fish Bowl", price: 11.99, category: "Bowls" },
  { id: "chicken-drumstick-bowl-2pc", name: "Chicken Drumstick Bowl (2pc)", price: 4.99, category: "Bowls" },
  { id: "chicken-drumstick-bowl-4pc", name: "Chicken Drumstick Bowl (4pc)", price: 9.99, category: "Bowls" },

  // Sandwiches
  { id: "chicken-strips-sandwich", name: "Chicken Strips Sandwich", price: 9.99, category: "Sandwiches" },
  { id: "shrimp-sandwich", name: "Shrimp Sandwich", price: 11.99, category: "Sandwiches" },
  { id: "fish-sandwich", name: "Fish Sandwich", price: 11.99, category: "Sandwiches" },

  // Combo Plates
  { id: "chicken-strips-combo-sm", name: "Chicken Strips Combo (Small)", price: 5.99, category: "Combo Plates" },
  { id: "chicken-strips-combo-lg", name: "Chicken Strips Combo (Large)", price: 9.99, category: "Combo Plates" },
  { id: "chicken-tenders-combo-sm", name: "Chicken Tenders Combo (Small)", price: 5.99, category: "Combo Plates" },
  { id: "chicken-tenders-combo-lg", name: "Chicken Tenders Combo (Large)", price: 9.99, category: "Combo Plates" },
  { id: "nashville-tenders-combo-sm", name: "Nashville Hot Tenders Combo (Small)", price: 5.99, category: "Combo Plates" },
  { id: "nashville-tenders-combo-lg", name: "Nashville Hot Tenders Combo (Large)", price: 9.99, category: "Combo Plates" },
  { id: "chicken-biryani-combo-sm", name: "Chicken Biryani Combo (Small)", price: 5.99, category: "Combo Plates" },
  { id: "chicken-biryani-combo-lg", name: "Chicken Biryani Combo (Large)", price: 9.99, category: "Combo Plates" },
  { id: "crispy-shrimp-combo-lg", name: "Crispy Shrimp Combo (Large)", price: 11.99, category: "Combo Plates" },
  { id: "golden-fish-combo-lg", name: "Golden Fish Combo (Large)", price: 11.99, category: "Combo Plates" },
  { id: "chicken-mandi-combo-1leg", name: "Chicken Mandi Combo (1 Leg Quarter)", price: 5.99, category: "Combo Plates" },
  { id: "chicken-mandi-combo-2leg", name: "Chicken Mandi Combo (2 Leg Quarters)", price: 9.99, category: "Combo Plates" },
  { id: "chicken-drumstick-combo-2pc", name: "Chicken Drumstick Combo (2pc)", price: 4.99, category: "Combo Plates" },
  { id: "chicken-drumstick-combo-4pc", name: "Chicken Drumstick Combo (4pc)", price: 9.99, category: "Combo Plates" },
  { id: "chicken-leg-mathbi-1qtr", name: "Chicken Leg Mathbi (1 Quarter)", price: 5.99, category: "Combo Plates" },
  { id: "chicken-leg-mathbi-2qtr", name: "Chicken Leg Mathbi (2 Quarters)", price: 9.99, category: "Combo Plates" },
  { id: "wings-4pc", name: "Wings (4pc)", price: 5.99, category: "Combo Plates" },
  { id: "wings-8pc", name: "Wings (8pc)", price: 9.99, category: "Combo Plates" },

  // Specials
  { id: "crispy-cheese", name: "Crispy Cheese", price: 9.99, category: "Specials" },
  { id: "crispy-cheese-nashville", name: "Crispy Cheese Nashville", price: 9.99, category: "Specials" },
  { id: "zinger-burger", name: "Zinger Burger", price: 9.99, category: "Specials" },
  { id: "crispy-burger", name: "Crispy Burger", price: 9.99, category: "Specials" },
  { id: "baked-chicken-roll", name: "Baked Chicken Roll", price: 9.99, category: "Specials" },
  { id: "crispy-chicken-roll", name: "Crispy Chicken Roll", price: 9.99, category: "Specials" },
  { id: "crispy-pizza-roll", name: "Crispy Pizza Roll", price: 9.99, category: "Specials" },
];

const business = businessesRepo.create({
  id: "king-chicken",
  name: "King Chicken",
  apiKey: generateApiKey(),
  googleCalendarId: "", // not using banquet/booking calendar for this demo
  restaurantInfo,
  menuItems,
  code: "KNG-0001",
});

console.log("King Chicken business created!");
console.log("Business ID:", business.id);
console.log("API Key:", business.api_key);
console.log("Code:", business.code);
console.log(`Menu items: ${menuItems.length}`);
