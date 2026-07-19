const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const chatRoutes = require("./routes/chat.routes");
const bookingRoutes = require("./routes/booking.routes");
const contactRoutes = require("./routes/contact.routes");
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
app.use(express.json({ limit: "1mb" }));
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
app.get("/api/health", (req, res) => res.json({ status: "ok", time: new Date().toISOString() }));
app.use("/api/chat", chatRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/contact", contactRoutes);
app.use((req, res) => res.status(404).json({ error: "Not found" }));
app.use(errorHandler);
module.exports = app;
