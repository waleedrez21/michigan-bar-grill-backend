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

app.use(helmet());
app.use(
  cors({
    origin: allowedOrigins.length ? allowedOrigins : true,
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
