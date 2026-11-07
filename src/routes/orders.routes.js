const express = require("express");
const resolveBusiness = require("../middleware/resolveBusiness");
const { resolvePublicBusiness } = resolveBusiness;
const { getMenu, postCheckout, listOrders, acceptOrder, completeOrder, getBySession } = require("../controllers/orders.controller");

const router = express.Router();

router.get("/menu", resolvePublicBusiness, getMenu);
router.post("/checkout", resolvePublicBusiness, postCheckout);
router.get("/", resolveBusiness, require("../middleware/firebaseUser"), require("../middleware/businessMember"), listOrders);
router.post("/:id/accept", resolveBusiness, require("../middleware/firebaseUser"), require("../middleware/businessMember"), acceptOrder);
router.post("/:id/complete", resolveBusiness, require("../middleware/firebaseUser"), require("../middleware/businessMember"), completeOrder);
router.get("/by-session/:sessionId", resolvePublicBusiness, getBySession);

module.exports = router;
