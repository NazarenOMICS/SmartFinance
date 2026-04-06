const express = require("express");
const { db, getSettingsObject, upsertSetting } = require("../db");

const router = express.Router();

function currentMonth() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
}

function getDefaultMonth() {
  return db.prepare("SELECT MAX(substr(fecha, 1, 7)) AS month FROM transactions").get()?.month || currentMonth();
}

router.get("/", (req, res) => {
  res.json({
    ...getSettingsObject(),
    default_month: getDefaultMonth()
  });
});

router.put("/", (req, res) => {
  const { key, value } = req.body;
  if (!key) {
    return res.status(400).json({ error: "key is required" });
  }

  upsertSetting(key, value);
  res.json({ key, value: String(value) });
});

module.exports = router;

