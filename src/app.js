const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const verificationRoutes = require("./routes/verification.routes");
const authRoutes = require("./routes/auth.routes");
const chatRoutes = require("./routes/chat.routes");
const bookingRoutes = require("./routes/booking.routes");
const businessesRoutes = require("./routes/businesses.routes");
const contactRoutes = require("./routes/contact.routes");
const ordersRoutes = require("./routes/orders.routes");
const { handleStripeWebhook } = require("./controllers/stripeWebhook.controller");
const errorHandler = require("./middleware/errorHandler");

const app = express();

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

// "*" (or leaving ALLOWED_ORIGINS unset) means allow any origin — useful
// while testing, but for production set this to your real site's domain(s)
// so other websites can't call your API from a browser.
const allowAllOrigins = allowedOrigins.length === 0 || allowedOrigins.includes("*");

app.use(helmet());
app.use(
  cors({
    origin: allowAllOrigins ? true : allowedOrigins,
  })
);

// IMPORTANT: Stripe's webhook needs the RAW request body (unparsed) to
// verify the request signature — it must be registered BEFORE the global
// express.json() parser below, and only for this one route.
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), handleStripeWebhook);

app.use(express.json({ limit: "1mb" }));
// Never log bearer booking-status tokens, customer URLs, or request bodies.
app.use(morgan(':method :status :response-time ms'));
app.use('/api', (req,res,next)=>{res.set('Cache-Control','no-store');next();});
app.use('/api', (req,res,next)=>req.method==='POST' ? require('./middleware/securityLimits').publicWrite(req,res,next):next());
app.use('/api', require('./routes/privacy.routes'));

app.get("/api/health", (req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

app.use("/api/chat", chatRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/orders", ordersRoutes);
app.use("/api/businesses", businessesRoutes);
app.use("/api", require("./routes/team.routes"));
app.use("/api/verification", verificationRoutes);
app.use("/api/auth", authRoutes);

app.use((req, res) => res.status(404).json({ error: "Not found" }));
app.use(errorHandler);

require('./services/bookingMaintenance.service').start();

module.exports = app;
