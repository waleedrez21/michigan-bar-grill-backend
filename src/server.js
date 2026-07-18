require("dotenv").config();
require("./db/db"); // ensures tables exist on boot
const app = require("./app");

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`Michigan Bar & Grill backend running on http://localhost:${PORT}`);
});
