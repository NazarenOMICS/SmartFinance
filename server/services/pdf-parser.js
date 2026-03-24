const fs = require("fs");
const pdf = require("pdf-parse");

async function parsePdfText(filePath) {
  const buffer = fs.readFileSync(filePath);
  const parsed = await pdf(buffer);
  return parsed.text || "";
}

module.exports = {
  parsePdfText
};

