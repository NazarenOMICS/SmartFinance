const apiUrl = String(process.env.SMARTFINANCE_API_URL || "").replace(/\/+$/, "");
const webUrl = String(process.env.SMARTFINANCE_WEB_URL || "").replace(/\/+$/, "");
const bearerToken = String(process.env.SMARTFINANCE_BEARER_TOKEN || "").trim();
const expectAuth = String(process.env.SMARTFINANCE_EXPECT_AUTH || "true").toLowerCase() !== "false";
const requireBearerToken = String(process.env.SMARTFINANCE_REQUIRE_BEARER_TOKEN || "false").toLowerCase() === "true";
const smokeMonth = String(process.env.SMARTFINANCE_SMOKE_MONTH || new Date().toISOString().slice(0, 7));

if (!apiUrl) {
  console.error("SMARTFINANCE_API_URL is required");
  process.exit(1);
}

async function readJson(path, options = {}) {
  const response = await fetch(`${apiUrl}${path}`, options);
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  return { response, data };
}

async function readRaw(url, options = {}) {
  return fetch(url, options);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  if (requireBearerToken && !bearerToken) {
    throw new Error("SMARTFINANCE_BEARER_TOKEN is required for this smoke run");
  }

  const health = await readJson("/api/health");
  assert(health.response.ok, `Health check failed with ${health.response.status}`);
  assert(health.data?.ok === true, "Health payload is missing ok=true");
  console.log("health ok");

  const schema = await readJson("/api/system/schema");
  assert(schema.response.ok, `Schema check failed with ${schema.response.status}`);
  assert(schema.data?.ok === true, "Schema status is not ok");
  console.log(`schema ok (${schema.data?.schema_version || "unknown"})`);

  if (expectAuth) {
    const unauthorized = await readJson("/api/accounts");
    assert(
      unauthorized.response.status === 401 || unauthorized.response.status === 403,
      `Expected protected /api/accounts to reject anonymous access, got ${unauthorized.response.status}`,
    );
    console.log("auth gate ok");

    const unauthorizedClientError = await readJson("/api/system/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "smoke unauthenticated client error" }),
    });
    assert(
      unauthorizedClientError.response.status === 401 || unauthorizedClientError.response.status === 403,
      `Expected /api/system/client-error to reject anonymous access, got ${unauthorizedClientError.response.status}`,
    );
    console.log("client error auth gate ok");

    const badOrigin = await readRaw(`${apiUrl}/api/health`, {
      headers: { Origin: "https://evil.example" },
    });
    assert(
      !badOrigin.headers.get("access-control-allow-origin"),
      "Unexpected CORS allow-origin for untrusted origin",
    );
    console.log("cors reject ok");
  }

  const apiSecurityHeaders = health.response.headers;
  assert(apiSecurityHeaders.get("x-content-type-options") === "nosniff", "API missing x-content-type-options");
  assert(apiSecurityHeaders.get("x-frame-options") === "DENY", "API missing x-frame-options");
  assert(Boolean(apiSecurityHeaders.get("content-security-policy")), "API missing content-security-policy");
  console.log("api security headers ok");

  if (bearerToken) {
    const headers = { Authorization: `Bearer ${bearerToken}` };
    const accounts = await readJson("/api/accounts", { headers });
    assert(accounts.response.ok, `Authorized accounts read failed with ${accounts.response.status}`);
    assert(Array.isArray(accounts.data), "Authorized accounts payload is not an array");
    console.log(`accounts ok (${accounts.data.length})`);

    const transactions = await readJson(`/api/transactions?month=${encodeURIComponent(smokeMonth)}`, { headers });
    assert(transactions.response.ok, `Authorized transactions read failed with ${transactions.response.status}`);
    assert(Array.isArray(transactions.data), "Authorized transactions payload is not an array");
    console.log(`transactions ok (${transactions.data.length})`);

    const usage = await readJson("/api/usage", { headers });
    assert(usage.response.ok, `Authorized usage read failed with ${usage.response.status}`);
    assert(usage.data?.subscription?.plan_code, "Authorized usage payload is missing subscription.plan_code");
    console.log(`usage ok (${usage.data.subscription.plan_code})`);

    const uploads = await readJson(`/api/uploads?month=${encodeURIComponent(smokeMonth)}`, { headers });
    assert(uploads.response.ok, `Authorized uploads read failed with ${uploads.response.status}`);
    assert(Array.isArray(uploads.data), "Authorized uploads payload is not an array");
    console.log(`uploads ok (${uploads.data.length})`);

    const clientError = await readJson("/api/system/client-error", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ message: "smoke authenticated client error", kind: "browser_error", path: "/smoke" }),
    });
    assert(clientError.response.ok, `Authorized client error report failed with ${clientError.response.status}`);
    console.log("client error authorized ok");
  } else {
    console.log("authorized checks skipped (SMARTFINANCE_BEARER_TOKEN not set)");
  }

  if (webUrl) {
    const web = await readRaw(webUrl);
    assert(web.ok, `Web check failed with ${web.status}`);
    assert(web.headers.get("x-content-type-options") === "nosniff", "Web missing x-content-type-options");
    assert(web.headers.get("x-frame-options") === "DENY", "Web missing x-frame-options");
    assert(Boolean(web.headers.get("content-security-policy")), "Web missing content-security-policy");
    console.log("web security headers ok");
  }

  console.log("deploy smoke passed");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
