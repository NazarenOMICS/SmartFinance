import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import ts from "typescript";

const root = resolve(import.meta.dirname, "..", "..");
const source = resolve(root, "smartfinance-saas", "packages", "domain", "src", "categorization", "index.ts");
const targets = [
  { path: resolve(root, "server", "vendor", "categorization.js"), moduleKind: ts.ModuleKind.CommonJS },
  { path: resolve(root, "worker", "vendor", "categorization.js"), moduleKind: ts.ModuleKind.ES2022 },
];

const input = await readFile(source, "utf8");

function transpile(moduleKind) {
  return [
    "// Generated from smartfinance-saas/packages/domain/src/categorization/index.ts",
    "// Do not edit by hand. Run: cd smartfinance-saas && corepack pnpm build:categorization-vendors",
    ts.transpileModule(input, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: moduleKind,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        esModuleInterop: true,
        removeComments: false,
      },
      fileName: "categorization.ts",
    }).outputText.trimEnd(),
    "",
  ].join("\n");
}

let failed = false;
for (const target of targets) {
  const expected = transpile(target.moduleKind);
  const actual = await readFile(target.path, "utf8");
  if (actual !== expected) {
    console.error(`Vendor out of date: ${target.path}`);
    failed = true;
  }
}

if (failed) {
  console.error("Run: cd smartfinance-saas && corepack pnpm build:categorization-vendors");
  process.exit(1);
}

console.log("Categorization vendors are in sync.");
