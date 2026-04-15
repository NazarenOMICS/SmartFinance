import { mkdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = resolve(rootDir, "apps", "api");
const persistDir = resolve(rootDir, ".wrangler", "e2e-state");
const persistDirFromApi = relative(apiDir, persistDir) || ".";

function run(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: "inherit",
      shell: true,
    });
    child.on("exit", (code) => {
      if (code === 0) resolvePromise(undefined);
      else rejectPromise(new Error(`${command} ${args.join(" ")} failed with code ${code}`));
    });
  });
}

await mkdir(persistDir, { recursive: true });

await run("corepack", [
  "pnpm",
  "--dir",
  "apps/api",
  "exec",
  "wrangler",
  "d1",
  "migrations",
  "apply",
  "DB",
  "--local",
  "--persist-to",
  persistDirFromApi,
]);

const devServer = spawn(
  "corepack",
  [
    "pnpm",
    "--dir",
    "apps/api",
    "exec",
    "wrangler",
    "dev",
    "--ip",
    "127.0.0.1",
    "--port",
    "8787",
    "--local",
    "--persist-to",
    persistDirFromApi,
  ],
  {
    cwd: rootDir,
    stdio: "inherit",
    shell: true,
  },
);

devServer.on("exit", (code) => {
  process.exit(code ?? 0);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    devServer.kill(signal);
  });
}
