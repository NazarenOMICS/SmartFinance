const express = require("express");
const { db } = require("../db");
const { getAccountById, getAccountsWithBalances, getConsolidatedSnapshot } = require("../services/accounts");

const router = express.Router();

router.get("/consolidated", (req, res) => {
  res.json(getConsolidatedSnapshot(db));
});

router.get("/", (req, res) => {
  res.json(getAccountsWithBalances(db));
});

router.post("/", (req, res) => {
  const { id, name, currency, balance = 0, opening_balance = null } = req.body;
  if (!id || !name || !currency) {
    return res.status(400).json({ error: "id, name and currency are required" });
  }

  const openingBalance = opening_balance == null ? Number(balance || 0) : Number(opening_balance);
  db.prepare("INSERT INTO accounts (id, name, currency, balance, opening_balance) VALUES (?, ?, ?, ?, ?)").run(id, name, currency, Number(balance || 0), openingBalance);
  res.status(201).json(getAccountById(db, id));
});

router.put("/:id", (req, res) => {
  const id = req.params.id;
  const current = db.prepare("SELECT * FROM accounts WHERE id = ?").get(id);

  if (!current) {
    return res.status(404).json({ error: "account not found" });
  }

  const next = {
    name: req.body.name ?? current.name
  };

  const transactionTotal = Number(
    db.prepare("SELECT COALESCE(SUM(monto), 0) AS total FROM transactions WHERE account_id = ?").get(id).total
  );
  const requestedLiveBalance = req.body.live_balance ?? req.body.balance;
  const nextOpeningBalance =
    req.body.opening_balance != null
      ? Number(req.body.opening_balance)
      : requestedLiveBalance != null
        ? Number(requestedLiveBalance) - transactionTotal
        : Number(current.opening_balance || 0);
  const nextLiveBalance = nextOpeningBalance + transactionTotal;

  db.prepare("UPDATE accounts SET name = ?, balance = ?, opening_balance = ? WHERE id = ?").run(
    next.name,
    nextLiveBalance,
    nextOpeningBalance,
    id
  );

  res.json(getAccountById(db, id));
});

router.delete("/:id", (req, res) => {
  const id = req.params.id;
  const hasTransactions = db.prepare("SELECT COUNT(*) AS count FROM transactions WHERE account_id = ?").get(id).count > 0;
  const hasLinks = db.prepare("SELECT COUNT(*) AS count FROM account_links WHERE account_a_id = ? OR account_b_id = ?").get(id, id).count > 0;

  if (hasTransactions || hasLinks) {
    return res.status(409).json({ error: "account has linked transactions or links" });
  }

  db.prepare("DELETE FROM accounts WHERE id = ?").run(id);
  res.status(204).send();
});

module.exports = router;

