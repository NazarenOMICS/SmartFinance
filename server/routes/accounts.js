const express = require("express");
const { convertAmount, db, getExchangeRateMap, getSettingsObject, SUPPORTED_CURRENCY_LIST } = require("../db");
const { getAccountById, getAccountsWithBalances, getConsolidatedSnapshot } = require("../services/accounts");

const router = express.Router();
const SUPPORTED_CURRENCIES = new Set(SUPPORTED_CURRENCY_LIST);

router.get("/consolidated", (req, res) => {
  const settings = getSettingsObject();
  const displayCurrency = settings.display_currency || "UYU";
  const exchangeRates = getExchangeRateMap(settings);
  const rows = getAccountsWithBalances(db);

  const total = rows.reduce((sum, account) => (
    sum + convertAmount(account.live_balance, account.currency, displayCurrency, exchangeRates)
  ), 0);

  res.json({ total, currency: displayCurrency, exchange_rate: exchangeRates[displayCurrency] || 1 });
});

router.get("/", (req, res) => {
  res.json(getAccountsWithBalances(db));
});

function slugify(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 48);
}

router.post("/", (req, res) => {
  const { id: requestedId, opening_balance = null } = req.body;
  const name = String(req.body.name || "").trim();
  const currency = String(req.body.currency || "").trim().toUpperCase();
  const balance = Number(req.body.balance ?? 0);

  if (!name || !currency) {
    return res.status(400).json({ error: "name and currency are required" });
  }

  // Use provided id or auto-generate from name
  let id = String(requestedId || "").trim();
  if (!id) {
    const base = slugify(name) || "cuenta";
    id = base;
    let suffix = 2;
    while (db.prepare("SELECT id FROM accounts WHERE id = ?").get(id)) {
      id = `${base}_${suffix++}`;
    }
  }

  if (!SUPPORTED_CURRENCIES.has(currency)) {
    return res.status(400).json({ error: `currency must be one of ${SUPPORTED_CURRENCY_LIST.join(", ")}` });
  }
  if (!Number.isFinite(balance)) {
    return res.status(400).json({ error: "balance must be a finite number" });
  }

  const existing = db.prepare("SELECT id FROM accounts WHERE id = ?").get(id);
  if (existing) {
    return res.status(409).json({ error: "account already exists" });
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
    name: req.body.name !== undefined ? String(req.body.name).trim() : current.name,
    balance: req.body.balance !== undefined ? Number(req.body.balance) : current.balance
  };
  if (!next.name) {
    return res.status(400).json({ error: "name is required" });
  }
  if (!Number.isFinite(next.balance)) {
    return res.status(400).json({ error: "balance must be a finite number" });
  }

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
  const force = req.query.force === "true";
  const existing = db.prepare("SELECT id FROM accounts WHERE id = ?").get(id);
  if (!existing) {
    return res.status(404).json({ error: "account not found" });
  }

  const transactionCount = db.prepare("SELECT COUNT(*) AS count FROM transactions WHERE account_id = ?").get(id).count;
  const uploadCount = db.prepare("SELECT COUNT(*) AS count FROM uploads WHERE account_id = ?").get(id).count;
  const installmentIds = db.prepare("SELECT id FROM installments WHERE account_id = ?").all(id).map((row) => row.id);

  if ((transactionCount > 0 || installmentIds.length > 0 || uploadCount > 0) && !force) {
    return res.status(409).json({
      error: "account has linked transactions, uploads or installments",
      tx_count: transactionCount,
      upload_count: uploadCount,
      installment_count: installmentIds.length,
    });
  }

  const deleteAccount = db.transaction((linkedInstallmentIds) => {
    if (linkedInstallmentIds.length > 0) {
      const placeholders = linkedInstallmentIds.map(() => "?").join(", ");
      db.prepare(`UPDATE transactions SET installment_id = NULL WHERE installment_id IN (${placeholders})`).run(...linkedInstallmentIds);
    }

    if (transactionCount > 0) {
      db.prepare("DELETE FROM transactions WHERE account_id = ?").run(id);
    }

    if (uploadCount > 0) {
      db.prepare("DELETE FROM uploads WHERE account_id = ?").run(id);
    }

    if (linkedInstallmentIds.length > 0) {
      const placeholders = linkedInstallmentIds.map(() => "?").join(", ");
      db.prepare(`DELETE FROM installments WHERE id IN (${placeholders})`).run(...linkedInstallmentIds);
    }

    db.prepare("DELETE FROM accounts WHERE id = ?").run(id);
  });

  deleteAccount(installmentIds);
  res.status(204).send();
});

module.exports = router;
