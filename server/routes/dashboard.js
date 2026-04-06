const express = require("express");
const { db } = require("../db");
const { computeDashboardPayload } = require("../services/metrics");

const router = express.Router();

router.get("/", (req, res) => {
  const { month } = req.query;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: "month is required in YYYY-MM format" });
  }

  res.json(computeDashboardPayload(db, month));
});

module.exports = router;
