const express = require("express");
const resolveBusiness = require("../middleware/resolveBusiness");
const { getMenu, postCheckout, listOrders, completeOrder } = require("../controllers/orders.controller");

const router = express.Router();

router.use(resolveBusiness);

router.get("/menu", getMenu);
router.post("/checkout", postCheckout);
router.get("/", listOrders);
router.post("/:id/complete", completeOrder);

module.exports = router;
