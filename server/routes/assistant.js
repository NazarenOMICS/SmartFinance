const express = require("express");
const { db } = require("../db");
const { answerAssistantQuestion } = require("../services/assistant");

const router = express.Router();

router.post("/chat", async (req, res, next) => {
  try {
    const { month, question } = req.body;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: "month is required in YYYY-MM format" });
    }

    if (!question || !String(question).trim()) {
      return res.status(400).json({ error: "question is required" });
    }

    const result = await answerAssistantQuestion(db, month, question);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
