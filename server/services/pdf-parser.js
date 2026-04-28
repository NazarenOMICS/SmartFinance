const fs = require("fs");
const pdf = require("pdf-parse");

function normalizePdfText(text) {
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((line) => !/^pagina\s+\d+/i.test(line) && !/^page\s+\d+/i.test(line));

  const merged = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\d{1,2}[\/.-]\d{1,2}(?:[\/.-]\d{2,4})?$/.test(line) && lines[i + 1]) {
      merged.push(`${line} ${lines[i + 1]}`);
      i += 1;
      continue;
    }
    merged.push(line);
  }

  return merged.join("\n");
}

async function parsePdfText(filePath) {
  const buffer = fs.readFileSync(filePath);
  const parsed = await pdf(buffer);
  return normalizePdfText(parsed.text || "");
}

module.exports = {
  parsePdfText,
  normalizePdfText
};
