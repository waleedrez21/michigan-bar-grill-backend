const express = require("express");
const resolveBusiness = require("../middleware/resolveBusiness");
const { getMenu, postCheckout, listOrders, acceptOrder, completeOrder, getBySession } = require("../controllers/orders.controller");

const router = express.Router();

router.use(resolveBusiness);

router.get("/menu", getMenu);
router.post("/checkout", postCheckout);
router.get("/", require("../middleware/firebaseUser"), require("../middleware/businessMember"), listOrders);
router.post("/:id/accept", require("../middleware/firebaseUser"), require("../middleware/businessMember"), acceptOrder);
router.post("/:id/complete", require("../middleware/firebaseUser"), require("../middleware/businessMember"), completeOrder);
router.get("/by-session/:sessionId", getBySession);

module.exports = router;
