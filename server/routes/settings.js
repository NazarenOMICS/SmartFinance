const express = require("express");
const { getSettingsObject, upsertSetting } = require("../db");

const router = express.Router();

router.get("/", (req, res) => {
  res.json(getSettingsObject());
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

