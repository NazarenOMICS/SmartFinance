const apiUrl = String(process.env.SMARTFINANCE_API_URL || "").replace(/\/+$/, "");
const bearerToken = String(process.env.SMARTFINANCE_BEARER_TOKEN || "").trim();
const expectAuth = String(process.env.SMARTFINANCE_EXPECT_AUTH || "true").toLowerCase() !== "false";
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
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
  }

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
  } else {
    console.log("authorized checks skipped (SMARTFINANCE_BEARER_TOKEN not set)");
  }

  console.log("deploy smoke passed");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
