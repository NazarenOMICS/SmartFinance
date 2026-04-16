import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import ts from "typescript";

const root = resolve(import.meta.dirname, "..", "..");
const source = resolve(root, "smartfinance-saas", "packages", "domain", "src", "categorization", "index.ts");
const serverTarget = resolve(root, "server", "vendor", "categorization.js");
const workerTarget = resolve(root, "worker", "vendor", "categorization.js");

const input = await readFile(source, "utf8");

function transpile(moduleKind) {
  const result = ts.transpileModule(input, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: moduleKind,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      esModuleInterop: true,
      removeComments: false,
    },
    fileName: "categorization.ts",
  });
  if (result.diagnostics?.length) {
    const messages = result.diagnostics.map((diagnostic) => diagnostic.messageText).join("\n");
    throw new Error(messages);
  }
  return result.outputText;
}

async function writeGenerated(target, contents) {
  await mkdir(dirname(target), { recursive: true });
  await writeFile(
    target,
    [
      "// Generated from smartfinance-saas/packages/domain/src/categorization/index.ts",
      "// Do not edit by hand. Run: cd smartfinance-saas && corepack pnpm build:categorization-vendors",
      contents.trimEnd(),
      "",
    ].join("\n"),
    "utf8",
  );
}

await writeGenerated(serverTarget, transpile(ts.ModuleKind.CommonJS));
await writeGenerated(workerTarget, transpile(ts.ModuleKind.ES2022));

console.log(`Generated ${serverTarget}`);
console.log(`Generated ${workerTarget}`);
