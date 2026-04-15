const express = require("express");
const { db } = require("../db");

const router = express.Router();

router.get("/:id", (req, res) => {
  const id = String(req.params.id || "").trim();
  const job = db.prepare("SELECT * FROM categorization_jobs WHERE id = ?").get(id);
  if (!job) return res.status(404).json({ error: "job not found" });
  res.json({ ...job, result: JSON.parse(job.result_json || "{}") });
});

module.exports = router;
