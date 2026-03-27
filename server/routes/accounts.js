const express = require("express");
const { db, getSettingsObject } = require("../db");

const router = express.Router();

router.get("/consolidated", (req, res) => {
  const settings = getSettingsObject();
  const usdRate = Number(settings.exchange_rate_usd_uyu || 1);
  const arsRate = Number(settings.exchange_rate_ars_uyu || 0.045);
  const displayCurrency = settings.display_currency || "UYU";
  const rows = db.prepare("SELECT * FROM accounts ORDER BY created_at ASC").all();

  const total = rows.reduce((sum, account) => {
    if (displayCurrency === account.currency) return sum + account.balance;
    // Normalize to UYU first, then convert to display currency
    let inUYU = account.balance;
    if (account.currency === "USD") inUYU = account.balance * usdRate;
    else if (account.currency === "ARS") inUYU = account.balance * arsRate;
    if (displayCurrency === "UYU") return sum + inUYU;
    if (displayCurrency === "USD") return sum + inUYU / usdRate;
    return sum + inUYU;
  }, 0);

  res.json({ total, currency: displayCurrency, exchange_rate: usdRate });
});

router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM accounts ORDER BY created_at ASC").all();
  res.json(rows);
});

router.post("/", (req, res) => {
  const { id, name, currency, balance = 0 } = req.body;
  if (!id || !name || !currency) {
    return res.status(400).json({ error: "id, name and currency are required" });
  }

  db.prepare("INSERT INTO accounts (id, name, currency, balance) VALUES (?, ?, ?, ?)").run(id, name, currency, balance);
  res.status(201).json(db.prepare("SELECT * FROM accounts WHERE id = ?").get(id));
});

router.put("/:id", (req, res) => {
  const id = req.params.id;
  const current = db.prepare("SELECT * FROM accounts WHERE id = ?").get(id);

  if (!current) {
    return res.status(404).json({ error: "account not found" });
  }

  const next = {
    name: req.body.name ?? current.name,
    balance: req.body.balance ?? current.balance
  };

  db.prepare("UPDATE accounts SET name = ?, balance = ? WHERE id = ?").run(next.name, next.balance, id);
  res.json(db.prepare("SELECT * FROM accounts WHERE id = ?").get(id));
});

router.delete("/:id", (req, res) => {
  const id = req.params.id;
  const force = req.query.force === "true";
  const hasTransactions = db.prepare("SELECT COUNT(*) AS count FROM transactions WHERE account_id = ?").get(id).count > 0;

  if (hasTransactions && !force) {
    return res.status(409).json({ error: "account has linked transactions" });
  }

  const deleteAccount = db.transaction(() => {
    if (hasTransactions) {
      db.prepare("DELETE FROM transactions WHERE account_id = ?").run(id);
    }
    db.prepare("DELETE FROM accounts WHERE id = ?").run(id);
  });

  deleteAccount();
  res.status(204).send();
});

module.exports = router;

