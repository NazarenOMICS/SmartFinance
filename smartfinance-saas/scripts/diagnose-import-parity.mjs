import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const workspaceRoot = path.resolve(repoRoot, "..");

function normalizeTransactions(transactions = []) {
  return transactions.map((transaction) => ({
    fecha: transaction.fecha,
    desc_banco: String(transaction.desc_banco || "").toLowerCase().replace(/\s+/g, " ").trim(),
    monto: Number(Number(transaction.monto).toFixed(2)),
  })).sort((left, right) =>
    `${left.fecha}|${left.desc_banco}|${left.monto}`.localeCompare(`${right.fecha}|${right.desc_banco}|${right.monto}`),
  );
}

function summarizeDiff(left, right) {
  const leftRows = normalizeTransactions(left.transactions);
  const rightRows = normalizeTransactions(right.transactions);
  const leftKeys = new Set(leftRows.map((row) => JSON.stringify(row)));
  const rightKeys = new Set(rightRows.map((row) => JSON.stringify(row)));

  return {
    legacy_count: leftRows.length,
    saas_count: rightRows.length,
    legacy_unmatched: left.unmatched?.length || 0,
    saas_unmatched: right.unmatched?.length || 0,
    missing_in_saas: leftRows.filter((row) => !rightKeys.has(JSON.stringify(row))),
    extra_in_saas: rightRows.filter((row) => !leftKeys.has(JSON.stringify(row))),
  };
}

async function loadLegacyExtractor() {
  const legacyServerPath = path.join(workspaceRoot, "server", "services", "tx-extractor.js");
  try {
    const legacy = require(legacyServerPath);
    if (typeof legacy.extractTransactions === "function") {
      return {
        source: "server/services/tx-extractor.js",
        extract: (fixture) => legacy.extractTransactions(fixture.content, undefined, fixture.period),
      };
    }
  } catch (error) {
    console.warn(`[diagnose] legacy server extractor unavailable: ${error.message}`);
  }

  const workerPath = path.join(workspaceRoot, "worker", "src", "services", "tx-extractor.js");
  const worker = await import(pathToFileURL(workerPath).href);
  return {
    source: "worker/src/services/tx-extractor.js",
    extract: (fixture) => worker.extractTransactions(fixture.content, undefined, fixture.period),
  };
}

const saasParsing = await import(pathToFileURL(path.join(repoRoot, "packages", "domain", "src", "parsing.ts")).href);
const legacy = await loadLegacyExtractor();
const fixtures = JSON.parse(await readFile(path.join(here, "import-parity-fixtures.json"), "utf8"));

const results = [];
let hasMismatch = false;
let hasRegression = false;

for (const fixture of fixtures) {
  const saas = fixture.source_type === "csv"
    ? saasParsing.extractTransactionsFromCsv(fixture.content, fixture.period)
    : saasParsing.extractTransactionsFromText(fixture.content, fixture.period);
  const legacyResult = fixture.source_type === "csv"
    ? { transactions: [], unmatched: [], skipped: "legacy route CSV parser is not directly importable" }
    : legacy.extract(fixture);
  const diff = fixture.source_type === "csv"
    ? {
      legacy_count: null,
      saas_count: saas.transactions.length,
      legacy_unmatched: null,
      saas_unmatched: saas.unmatched.length,
      missing_in_saas: [],
      extra_in_saas: [],
    }
    : summarizeDiff(legacyResult, saas);

  const mismatch = diff.missing_in_saas.length > 0 || diff.extra_in_saas.length > 0;
  const regression = fixture.source_type !== "csv"
    && (
      Number(diff.saas_count || 0) < Number(diff.legacy_count || 0)
      || Number(diff.saas_unmatched || 0) > Number(diff.legacy_unmatched || 0)
    );
  hasMismatch = hasMismatch || mismatch;
  hasRegression = hasRegression || regression;
  results.push({
    id: fixture.id,
    source_type: fixture.source_type,
    legacy_source: legacy.source,
    detected_format: saas.detectedFormat || null,
    mismatch,
    regression,
    ...diff,
  });
}

console.log(JSON.stringify({
  ok: !hasRegression,
  mismatch_is_regression: false,
  generated_at: new Date().toISOString(),
  results,
}, null, 2));

if (hasRegression) {
  process.exitCode = 1;
}
