require("dotenv").config();
const businessesRepo = require("../src/db/businessesRepo");

const menuItems = [
  // Breakfast
  { id: "diner-breakfast", name: "Diner Breakfast", price: 11.99, category: "Breakfast", description: "2 Eggs, choice of bacon, sausage, or peameal, served with home fries and toast" },
  { id: "michigan-big-breakfast", name: "Michigan Big Breakfast", price: 14.99, category: "Breakfast", description: "3 Eggs, 2 bacon strips, 2 sausage links, 2 slices of peameal bacon, home fries & toast" },
  { id: "steak-eggs", name: "Steak & Eggs", price: 17.99, category: "Breakfast", description: "2 Eggs with N.Y. steak, served with home fries & toast" },
  { id: "2eggs-toast", name: "2 Eggs & Toast", price: 7.99, category: "Breakfast" },
  { id: "2eggs-meat", name: "2 Eggs & Choice of Meat", price: 8.99, category: "Breakfast" },

  // Omelettes
  { id: "western-omelette", name: "Western Omelette", price: 13.99, category: "Omelettes", description: "Ham, green pepper, onions & cheese" },
  { id: "omelette-lovers", name: "Omelette Lovers", price: 14.99, category: "Omelettes", description: "Your choice of ham, bacon or sausage & cheese" },
  { id: "bacon-swiss-mushroom-omelette", name: "Bacon Swiss Mushroom Omelette", price: 13.99, category: "Omelettes" },
  { id: "mexican-omelette", name: "Mexican Omelette", price: 14.99, category: "Omelettes", description: "Green pepper, tomatoes, onions, cheese & chili" },
  { id: "plain-cheese-omelette", name: "Plain or Cheese Omelette", price: 12.99, category: "Omelettes", description: "With your choice of cheese" },

  // From the Grill
  { id: "texas-french-toast-3pc", name: "Texas French Toast (3pc)", price: 9.99, category: "From the Grill" },
  { id: "texas-french-toast-2pc", name: "Texas French Toast (2pc)", price: 7.99, category: "From the Grill" },
  { id: "pancakes-3pc", name: "Pancakes (3pc)", price: 9.99, category: "From the Grill" },
  { id: "pancakes-2pc", name: "Pancakes (2pc)", price: 7.99, category: "From the Grill" },

  // Extras
  { id: "extra-strawberry-topping", name: "Strawberry Topping", price: 2.99, category: "Extras" },
  { id: "extra-bacon-sausage", name: "Extra Bacon or Sausage", price: 4.99, category: "Extras" },
  { id: "extra-peameal", name: "Extra Peameal", price: 5.99, category: "Extras" },
  { id: "extra-egg", name: "Extra Egg", price: 2.25, category: "Extras" },
  { id: "extra-toast", name: "Extra Toast", price: 2.25, category: "Extras" },

  // Specials
  { id: "half-slab-ribs", name: "1/2 Slab Ribs", price: 17.99, category: "Specials", description: "Coleslaw and choice of potatoes" },
  { id: "4pc-chicken-dark", name: "4 Piece Chicken (Dark Meat)", price: 14.99, category: "Specials", description: "Coleslaw and choice of potatoes" },
  { id: "pork-chops", name: "Pork Chops", price: 18.99, category: "Specials", description: "Vegetables and choice of potatoes" },
  { id: "perch", name: "Perch", price: 19.99, category: "Specials", description: "Coleslaw and choice of potatoes" },
];

const updated = businessesRepo.updateMenuItems("michigan-bar-grill", menuItems);
console.log(`Menu updated! ${menuItems.length} items saved for ${updated.name}.`);
