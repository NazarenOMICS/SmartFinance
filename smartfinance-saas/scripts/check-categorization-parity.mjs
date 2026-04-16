import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const workspaceRoot = path.resolve(repoRoot, "..");
const fixturePath = path.join(repoRoot, "fixtures", "categorization", "uyu-transactions.fixture.json");

const domain = await import(pathToFileURL(path.join(repoRoot, "packages", "domain", "src", "categorization", "index.ts")).href);
const server = require(path.join(workspaceRoot, "server", "vendor", "categorization.js"));
const worker = await import(pathToFileURL(path.join(workspaceRoot, "worker", "vendor", "categorization.js")).href);
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));

const engines = [
  ["domain", domain],
  ["server", server],
  ["worker", worker],
];

function round(value) {
  return value == null ? null : Number(Number(value).toFixed(4));
}

function classify(engine, item) {
  const merchant = engine.extractMerchant(item.tx.desc_banco, fixture.dictionary);
  const decision = engine.classifyTransaction(item.tx, fixture.rules, [], fixture.settings, fixture.dictionary);
  return {
    merchant_key: merchant.merchant_key,
    merchant_method: merchant.method,
    status: decision.categorizationStatus,
    category_id: decision.categoryId,
    category_source: decision.categorySource,
    category_confidence: round(decision.categoryConfidence),
    rule_id: decision.categoryRuleId,
    layer: decision.layer,
  };
}

function expected(item) {
  return {
    merchant_key: item.expected.merchant_key,
    merchant_method: item.expected.merchant_method,
    status: item.expected.status,
    category_id: item.expected.category_id,
    category_source: item.expected.category_source,
    category_confidence: round(item.expected.category_confidence),
    rule_id: item.expected.rule_id,
    layer: item.expected.layer,
  };
}

function equivalent(left, right) {
  if (left.merchant_key !== right.merchant_key) return false;
  if (left.merchant_method !== right.merchant_method) return false;
  if (left.status !== right.status) return false;
  if (left.category_id !== right.category_id) return false;
  if (left.category_source !== right.category_source) return false;
  if (left.rule_id !== right.rule_id) return false;
  if (left.layer !== right.layer) return false;
  if (left.category_confidence == null || right.category_confidence == null) {
    return left.category_confidence === right.category_confidence;
  }
  return Math.abs(left.category_confidence - right.category_confidence) <= 0.02;
}

const failures = [];
const summary = {
  cases: fixture.cases.length,
  categorized: 0,
  suggested: 0,
  uncategorized: 0,
  rejected: 0,
};

for (const item of fixture.cases) {
  const expectedResult = expected(item);
  summary[expectedResult.status] = (summary[expectedResult.status] || 0) + 1;

  const outputs = Object.fromEntries(engines.map(([name, engine]) => [name, classify(engine, item)]));
  for (const [name, output] of Object.entries(outputs)) {
    if (!equivalent(output, expectedResult)) {
      failures.push({
        id: item.id,
        engine: name,
        desc_banco: item.tx.desc_banco,
        expected: expectedResult,
        actual: output,
      });
    }
  }
  if (!equivalent(outputs.domain, outputs.server) || !equivalent(outputs.domain, outputs.worker)) {
    failures.push({
      id: item.id,
      engine: "parity",
      desc_banco: item.tx.desc_banco,
      domain: outputs.domain,
      server: outputs.server,
      worker: outputs.worker,
    });
  }
}

console.log(JSON.stringify({
  ok: failures.length === 0,
  fixture: fixture.id,
  generated_at: fixture.generated_at,
  summary,
  failures,
}, null, 2));

if (failures.length > 0) {
  process.exitCode = 1;
}
