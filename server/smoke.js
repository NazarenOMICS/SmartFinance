const { createApp } = require("./app");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function requestJson(baseUrl, pathname) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    signal: AbortSignal.timeout(10000),
  });

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  assert(response.ok, `Smoke check failed for ${pathname} (${response.status})`);
  return payload;
}

async function main() {
  const app = createApp({ startSchedulers: false });
  const server = await new Promise((resolve) => {
    const nextServer = app.listen(0, "127.0.0.1", () => resolve(nextServer));
  });

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const health = await requestJson(baseUrl, "/api/health");
    assert(health.ok === true, "Health endpoint did not return ok=true");

    const schema = await requestJson(baseUrl, "/api/system/schema");
    assert(typeof schema.ok === "boolean", "Schema endpoint did not return expected payload");

    const settings = await requestJson(baseUrl, "/api/settings");
    assert(typeof settings === "object" && settings !== null, "Settings endpoint returned an invalid payload");

    const accounts = await requestJson(baseUrl, "/api/accounts");
    assert(Array.isArray(accounts), "Accounts endpoint did not return an array");

    const categories = await requestJson(baseUrl, "/api/categories");
    assert(Array.isArray(categories), "Categories endpoint did not return an array");

    const dashboard = await requestJson(baseUrl, "/api/dashboard?month=2026-03");
    assert(typeof dashboard === "object" && dashboard !== null, "Dashboard endpoint returned an invalid payload");

    console.log("Smoke checks passed.");
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
