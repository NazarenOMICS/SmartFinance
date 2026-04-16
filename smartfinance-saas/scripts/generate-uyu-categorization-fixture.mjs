import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  classifyTransaction,
  extractMerchant,
} from "../packages/domain/src/categorization/index.ts";
import { extractTransactionsFromCsv } from "../packages/domain/src/parsing.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const defaultInput = "C:/Users/Naza/Downloads/uyu.csv";
const inputPath = path.resolve(process.argv[2] || defaultInput);
const outputDir = path.join(repoRoot, "fixtures", "categorization");
const fixturePath = path.join(outputDir, "uyu-transactions.fixture.json");
const reviewPath = path.join(outputDir, "uyu-categorization-review.csv");

const settings = {
  categorizer_auto_threshold: 0.92,
  categorizer_suggest_threshold: 0.65,
};

const categories = {
  Transporte: 1,
  Supermercado: 2,
  "Comer afuera": 3,
  Entretenimiento: 4,
};

const dictionary = [
  { merchant_key: "uber", display_name: "Uber", aliases: ["dlo uber rides", "uber rides"] },
  { merchant_key: "disco", display_name: "Disco", aliases: ["disco"] },
  { merchant_key: "frog", display_name: "Frog", aliases: ["frog"] },
  { merchant_key: "subway", display_name: "Subway", aliases: ["subway"] },
  { merchant_key: "mcdonalds", display_name: "McDonald's", aliases: ["mcdonalds", "mcdonald"] },
  { merchant_key: "burger king", display_name: "Burger King", aliases: ["burger king"] },
  { merchant_key: "iberpark", display_name: "Iberpark", aliases: ["iberpark"] },
  { merchant_key: "cafeteria infinito", display_name: "Cafeteria Infinito", aliases: ["cafeteria infinito"] },
  { merchant_key: "cafe del puerto", display_name: "Cafe del Puerto", aliases: ["rest cafe del puerto", "cafe del puerto"] },
  { merchant_key: "cines life", display_name: "Cines Life", aliases: ["cines life"] },
  { merchant_key: "cot", display_name: "COT", aliases: ["cot trpacot", "cot"] },
];

const learnedRules = [
  rule(1, "uber", categories.Transporte),
  rule(2, "disco", categories.Supermercado),
  rule(3, "frog", categories.Supermercado),
  rule(4, "subway", categories["Comer afuera"]),
  rule(5, "mcdonalds", categories["Comer afuera"]),
  rule(6, "burger king", categories["Comer afuera"]),
  rule(7, "cafeteria infinito", categories["Comer afuera"]),
  rule(8, "cafe del puerto", categories["Comer afuera"]),
  rule(9, "iberpark", categories.Transporte),
  rule(10, "cines life", categories.Entretenimiento),
  rule(11, "cot", categories.Transporte),
];

function rule(id, merchantKey, categoryId) {
  return {
    id,
    pattern: merchantKey.toUpperCase(),
    normalized_pattern: merchantKey,
    merchant_key: merchantKey,
    merchant_scope: merchantKey,
    category_id: categoryId,
    direction: "expense",
    mode: "auto",
    source: "manual",
    confidence: 0.99,
    match_count: 30,
    last_matched_at: "2026-04-15T00:00:00.000Z",
  };
}

function csvCell(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function reasonForReview(caseResult) {
  if (!caseResult.expected.merchant_key) return "needs_user_context";
  if (caseResult.expected.merchant_method === "token" || caseResult.expected.merchant_method === "ngram") return "merchant_needs_human_confirmation";
  if (caseResult.expected.status === "uncategorized") return "no_learned_rule_or_income_refund";
  return "";
}

const content = await readFile(inputPath, "latin1");
const parsed = extractTransactionsFromCsv(content, "2026-04");

const cases = parsed.transactions.map((tx, index) => {
  const merchant = extractMerchant(tx.desc_banco, dictionary);
  const decision = classifyTransaction(tx, learnedRules, [], settings, dictionary);
  const result = {
    id: `uyu-${String(index + 1).padStart(3, "0")}`,
    tx: {
      fecha: tx.fecha,
      desc_banco: tx.desc_banco,
      monto: tx.monto,
      moneda: tx.moneda || "UYU",
      account_id: "brou_uyu",
    },
    expected: {
      merchant_key: merchant.merchant_key,
      merchant_method: merchant.method,
      merchant_confidence: merchant.confidence,
      status: decision.categorizationStatus,
      category_id: decision.categoryId,
      category_source: decision.categorySource,
      category_confidence: decision.categoryConfidence,
      rule_id: decision.categoryRuleId,
      layer: decision.layer,
      reason: decision.reason,
    },
  };
  return {
    ...result,
    review_note: reasonForReview(result),
  };
});

const fixture = {
  id: "uyu-april-2026",
  source: "C:/Users/Naza/Downloads/uyu.csv",
  generated_at: new Date().toISOString(),
  parse: {
    detected_format: parsed.detectedFormat,
    transaction_count: parsed.transactions.length,
    unmatched_count: parsed.unmatched.length,
    unmatched: parsed.unmatched,
  },
  settings,
  categories,
  dictionary,
  rules: learnedRules,
  cases,
};

const reviewHeader = [
  "id",
  "fecha",
  "monto",
  "desc_banco",
  "merchant_key",
  "merchant_method",
  "status",
  "category_id",
  "confidence",
  "review_note",
  "expected_category_user_review",
  "notes",
];
const reviewRows = cases.map((item) => [
  item.id,
  item.tx.fecha,
  item.tx.monto,
  item.tx.desc_banco,
  item.expected.merchant_key || "",
  item.expected.merchant_method,
  item.expected.status,
  item.expected.category_id || "",
  item.expected.category_confidence || "",
  item.review_note,
  "",
  "",
].map(csvCell).join(","));

await mkdir(outputDir, { recursive: true });
await writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
await writeFile(reviewPath, `${reviewHeader.join(",")}\n${reviewRows.join("\n")}\n`, "utf8");

console.log(JSON.stringify({
  ok: true,
  input: inputPath,
  fixture: fixturePath,
  review: reviewPath,
  detected_format: parsed.detectedFormat,
  transactions: parsed.transactions.length,
  unmatched: parsed.unmatched.length,
  categorized: cases.filter((item) => item.expected.status === "categorized").length,
  suggested: cases.filter((item) => item.expected.status === "suggested").length,
  uncategorized: cases.filter((item) => item.expected.status === "uncategorized").length,
  review_needed: cases.filter((item) => item.review_note).length,
}, null, 2));
