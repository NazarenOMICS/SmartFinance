const express = require("express");
const { getSettingsObject, normalizeSettingValue, upsertSetting } = require("../db");

const router = express.Router();

router.get("/", (req, res) => {
  res.json(getSettingsObject());
});

router.put("/", (req, res) => {
  const { key, value } = req.body;
  if (!key) {
    return res.status(400).json({ error: "key is required" });
  }

  const normalizedValue = normalizeSettingValue(key, value);
  upsertSetting(key, normalizedValue);
  res.json({ key, value: normalizedValue });
});

module.exports = router;

