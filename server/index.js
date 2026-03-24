const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const { seed } = require("./seed");
const transactionsRouter = require("./routes/transactions");
const categoriesRouter = require("./routes/categories");
const accountsRouter = require("./routes/accounts");
const rulesRouter = require("./routes/rules");
const installmentsRouter = require("./routes/installments");
const savingsRouter = require("./routes/savings");
const settingsRouter = require("./routes/settings");
const uploadRouter = require("./routes/upload");
const exportRouter = require("./routes/export");

const app = express();
const PORT = process.env.PORT || 3001;
const uploadsDir = path.join(__dirname, "..", "uploads");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

seed();

app.use(cors({
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : true
}));
app.use(express.json());
app.use("/uploads", express.static(uploadsDir));

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.use("/api/transactions", transactionsRouter);
app.use("/api/categories", categoriesRouter);
app.use("/api/accounts", accountsRouter);
app.use("/api/rules", rulesRouter);
app.use("/api/installments", installmentsRouter);
app.use("/api/savings", savingsRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/upload", uploadRouter);
app.use("/api/export", exportRouter);

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ error: error.message || "Unexpected server error" });
});

app.listen(PORT, () => {
  console.log(`Finance Tracker API listening on http://localhost:${PORT}`);
});
