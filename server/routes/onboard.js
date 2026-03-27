const express = require("express");
const { db } = require("../db");

const router = express.Router();

const DEFAULT_CATEGORIES = [
  { name: "Alquiler",      type: "fijo",     budget: 18000, color: "#639922", sort_order: 1 },
  { name: "Supermercado",  type: "variable", budget: 12000, color: "#534AB7", sort_order: 2 },
  { name: "Transporte",    type: "variable", budget:  6000, color: "#1D9E75", sort_order: 3 },
  { name: "Suscripciones", type: "fijo",     budget:  5000, color: "#D85A30", sort_order: 4 },
  { name: "Restaurantes",  type: "variable", budget:  8000, color: "#378ADD", sort_order: 5 },
  { name: "Servicios",     type: "fijo",     budget:  7000, color: "#BA7517", sort_order: 6 },
  { name: "Salud",         type: "variable", budget:  4000, color: "#E24B4A", sort_order: 7 },
  { name: "Otros",         type: "variable", budget:  5000, color: "#888780", sort_order: 8 },
];

// POST /api/onboard — idempotent: seeds default categories if none exist
router.post("/", (req, res) => {
  const count = db.prepare("SELECT COUNT(*) AS n FROM categories").get().n;
  if (count > 0) {
    return res.json({ status: "existing" });
  }

  const insertCategory = db.prepare(
    "INSERT OR IGNORE INTO categories (name, type, budget, color, sort_order) VALUES (?, ?, ?, ?, ?)"
  );

  db.transaction(() => {
    for (const cat of DEFAULT_CATEGORIES) {
      insertCategory.run(cat.name, cat.type, cat.budget, cat.color, cat.sort_order);
    }
  })();

  res.json({ status: "created" });
});

// POST /api/onboard/claim-legacy — no-op for local Express server
router.post("/claim-legacy", (req, res) => {
  res.json({ claimed: 0 });
});

module.exports = router;
