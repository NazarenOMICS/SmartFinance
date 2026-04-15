const express = require("express");
const { db } = require("../db");
const { getCanonicalCategoryByName, slugifyCategoryName } = require("../services/taxonomy");

const router = express.Router();
const SUPPORTED_CATEGORY_TYPES = new Set(["variable", "fijo", "transferencia"]);

function getHiddenSeedCategorySlugs() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'hidden_seed_category_slugs' LIMIT 1").get();
  try {
    const parsed = JSON.parse(String(row?.value || "[]"));
    return new Set(Array.isArray(parsed) ? parsed.map((item) => String(item || "").trim()).filter(Boolean) : []);
  } catch {
    return new Set();
  }
}

function saveHiddenSeedCategorySlugs(slugs) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('hidden_seed_category_slugs', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(JSON.stringify([...new Set(slugs)].sort()));
}

router.get("/", (req, res) => {
  res.json(
    db.prepare(
      `SELECT c.*,
              COUNT(t.id) AS usage_count
       FROM categories c
       LEFT JOIN transactions t ON t.category_id = c.id
       GROUP BY c.id
       ORDER BY c.sort_order ASC, c.id ASC`
    ).all()
  );
});

router.post("/", (req, res) => {
  const { name, budget = 0, type = "variable", color = null } = req.body;
  const normalizedName = String(name || "").trim();
  const normalizedBudget = type === "fijo" ? 0 : Number(budget);
  if (!normalizedName) return res.status(400).json({ error: "name is required" });
  if (!Number.isFinite(normalizedBudget)) return res.status(400).json({ error: "budget must be a finite number" });
  if (!SUPPORTED_CATEGORY_TYPES.has(type)) return res.status(400).json({ error: "type must be fijo, variable or transferencia" });

  const slug = slugifyCategoryName(normalizedName);
  const hiddenSeedSlugs = getHiddenSeedCategorySlugs();
  const duplicate = db.prepare("SELECT id FROM categories WHERE slug = ? LIMIT 1").get(slug);
  const duplicateByName = db.prepare("SELECT id FROM categories WHERE name = ? COLLATE NOCASE LIMIT 1").get(normalizedName);
  if (duplicate || duplicateByName || (getCanonicalCategoryByName(normalizedName) && !hiddenSeedSlugs.has(slug))) {
    return res.status(409).json({ error: `Ya existe una categoria con el nombre "${normalizedName}"` });
  }

  const result = db.prepare(
    "INSERT INTO categories (name, budget, type, color, slug, origin) VALUES (?, ?, ?, ?, ?, 'manual')"
  ).run(normalizedName, normalizedBudget, type, color, slug);
  res.status(201).json(db.prepare("SELECT * FROM categories WHERE id = ?").get(result.lastInsertRowid));
});

router.put("/:id", (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare("SELECT * FROM categories WHERE id = ?").get(id);
  if (!current) return res.status(404).json({ error: "category not found" });

  const next = {
    name: req.body.name !== undefined ? String(req.body.name).trim() : current.name,
    budget: (req.body.type ?? current.type) === "fijo"
      ? 0
      : (req.body.budget !== undefined ? Number(req.body.budget) : current.budget),
    type: req.body.type ?? current.type,
    color: req.body.color ?? current.color,
  };
  if (!next.name) return res.status(400).json({ error: "name is required" });
  if (!Number.isFinite(next.budget)) return res.status(400).json({ error: "budget must be a finite number" });
  if (!SUPPORTED_CATEGORY_TYPES.has(next.type)) return res.status(400).json({ error: "type must be fijo, variable or transferencia" });

  const slug = current.origin === "seed" ? current.slug : slugifyCategoryName(next.name);
  const duplicate = db.prepare("SELECT id FROM categories WHERE slug = ? AND id != ?").get(slug, id);
  if (duplicate) return res.status(409).json({ error: `Ya existe una categoria con el nombre "${next.name}"` });

  db.prepare(
    "UPDATE categories SET name = ?, budget = ?, type = ?, color = ?, slug = ?, origin = ? WHERE id = ?"
  ).run(next.name, next.budget, next.type, next.color, slug, current.origin === "seed" ? "seed" : "manual", id);

  res.json(db.prepare("SELECT * FROM categories WHERE id = ?").get(id));
});

router.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM categories WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "category not found" });

  const txCount = db.prepare("SELECT COUNT(*) AS count FROM transactions WHERE category_id = ?").get(id);
  if (Number(txCount?.count || 0) > 0) {
    return res.status(409).json({ error: "category_has_transactions" });
  }

  try {
    db.transaction(() => {
      if (existing.origin === "seed") {
        const hidden = getHiddenSeedCategorySlugs();
        hidden.add(existing.slug);
        saveHiddenSeedCategorySlugs(hidden);
      }
      db.prepare("DELETE FROM rule_match_log WHERE category_id = ?").run(id);
      db.prepare("DELETE FROM rule_exclusions WHERE rule_id IN (SELECT id FROM rules WHERE category_id = ?)").run(id);
      db.prepare("DELETE FROM rule_rejections WHERE rule_id IN (SELECT id FROM rules WHERE category_id = ?)").run(id);
      db.prepare("DELETE FROM rules WHERE category_id = ?").run(id);
      db.prepare("DELETE FROM merchant_dictionary WHERE default_category_id = ?").run(id);
      db.prepare("DELETE FROM categories WHERE id = ?").run(id);
    })();
    const stillThere = db.prepare("SELECT id FROM categories WHERE id = ?").get(id);
    if (stillThere) return res.status(500).json({ error: "CATEGORY_DELETE_FAILED" });
    return res.status(204).send();
  } catch (error) {
    const message = error instanceof Error ? error.message : "category delete failed";
    const isConstraint = /constraint|foreign key/i.test(message);
    return res.status(isConstraint ? 409 : 500).json({
      error: isConstraint ? "CATEGORY_HAS_DEPENDENCIES" : "CATEGORY_DELETE_FAILED",
    });
  }
});

module.exports = router;
