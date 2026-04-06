const express = require("express");
const { db } = require("../db");
const { findAccountLink, getAccountLinks, normalizeLinkPair, reconcileAccountLinkTransactions } = require("../services/accounts");

const router = express.Router();

router.get("/", (req, res) => {
  res.json(getAccountLinks(db));
});

router.post("/", (req, res) => {
  const { account_a_id, account_b_id, relation_type = "fx_pair" } = req.body;

  if (!account_a_id || !account_b_id) {
    return res.status(400).json({ error: "account_a_id and account_b_id are required" });
  }

  if (account_a_id === account_b_id) {
    return res.status(400).json({ error: "linked accounts must be different" });
  }

  const leftAccount = db.prepare("SELECT id FROM accounts WHERE id = ?").get(account_a_id);
  const rightAccount = db.prepare("SELECT id FROM accounts WHERE id = ?").get(account_b_id);
  if (!leftAccount || !rightAccount) {
    return res.status(404).json({ error: "account not found" });
  }

  const [leftId, rightId] = normalizeLinkPair(account_a_id, account_b_id);
  const existingLink = findAccountLink(db, leftId, rightId);
  if (existingLink) {
    return res.status(409).json({ error: "account link already exists" });
  }

  const result = db
    .prepare("INSERT INTO account_links (account_a_id, account_b_id, relation_type) VALUES (?, ?, ?)");

  try {
    const insertResult = result.run(leftId, rightId, relation_type);
    const created = getAccountLinks(db).find((item) => item.id === insertResult.lastInsertRowid);
    return res.status(201).json(created);
  } catch (error) {
    if (String(error.message || "").includes("UNIQUE")) {
      return res.status(409).json({ error: "account link already exists" });
    }

    throw error;
  }
});

router.post("/:id/reconcile", (req, res) => {
  try {
    const result = reconcileAccountLinkTransactions(db, req.params.id, {
      month: req.body?.month || null
    });

    return res.json(result);
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM account_links WHERE id = ?").run(Number(req.params.id));
  res.status(204).send();
});

module.exports = router;
