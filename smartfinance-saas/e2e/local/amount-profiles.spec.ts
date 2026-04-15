import { expect, test, type APIRequestContext } from "@playwright/test";
import { resetLocalDataset } from "../helpers/local";

test.beforeEach(async ({ request }) => {
  await resetLocalDataset(request);
});

async function createCategory(request: APIRequestContext, name: string) {
  const response = await request.post("http://127.0.0.1:8787/api/categories", {
    data: {
      name,
      slug: name.toLowerCase().replace(/\s+/g, "-"),
      type: "variable",
      budget: 0,
      color: "#534AB7",
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

async function createTransaction(request: APIRequestContext, input: Record<string, unknown>) {
  const response = await request.post("http://127.0.0.1:8787/api/transactions", {
    data: input,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

test("categoriza por contraparte y rango de monto cuando una misma persona tiene gastos distintos", async ({ request }) => {
  await request.post("http://127.0.0.1:8787/api/accounts", {
    data: {
      id: "amount_profile_uyu",
      name: "Amount Profile UYU",
      currency: "UYU",
      balance: 0,
      opening_balance: 0,
    },
  });

  const alquiler = await createCategory(request, "Alquiler perfil");
  const luz = await createCategory(request, "Luz perfil");

  const base = {
    desc_banco: "TRANSFERENCIA INMEDIATA A MARIA DELACROIX",
    moneda: "UYU",
    account_id: "amount_profile_uyu",
    entry_type: "expense",
  };

  for (const [index, amount] of [30000, 30200, 29900].entries()) {
    await createTransaction(request, {
      ...base,
      fecha: `2026-01-0${index + 1}`,
      monto: amount,
      category_id: alquiler.id,
    });
  }

  for (const [index, amount] of [3000, 3150, 2900].entries()) {
    await createTransaction(request, {
      ...base,
      fecha: `2026-02-0${index + 1}`,
      monto: amount,
      category_id: luz.id,
    });
  }

  const profilesResponse = await request.get("http://127.0.0.1:8787/api/rules/amount-profiles");
  expect(profilesResponse.ok(), await profilesResponse.text()).toBe(true);
  const profiles = await profilesResponse.json();
  expect(profiles.profiles.filter((profile) => profile.counterparty_key === "maria delacroix")).toHaveLength(2);

  const nextRent = await createTransaction(request, {
    ...base,
    fecha: "2026-03-01",
    monto: 30500,
  });
  expect(nextRent.category_id).toBe(alquiler.id);
  expect(nextRent.category_source).toBe("amount_profile");
  expect(nextRent.categorization_status).toBe("categorized");

  const nextLight = await createTransaction(request, {
    ...base,
    fecha: "2026-03-02",
    monto: 3100,
  });
  expect(nextLight.category_id).toBe(luz.id);
  expect(nextLight.category_source).toBe("amount_profile");
});
