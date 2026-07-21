const express = require("express");
const resolveBusiness = require("../middleware/resolveBusiness");
const { getMenu, postCheckout, listOrders, completeOrder, getBySession } = require("../controllers/orders.controller");
// ...
router.get("/by-session/:sessionId", getBySession);

const router = express.Router();

router.use(resolveBusiness);

router.get("/menu", getMenu);
router.post("/checkout", postCheckout);
router.get("/", listOrders);
router.post("/:id/complete", completeOrder);

module.exports = router;


