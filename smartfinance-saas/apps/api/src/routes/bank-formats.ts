import { Hono } from "hono";
import { bankFormatSchema, bankFormatSuggestionInputSchema, bankFormatSuggestionSchema, upsertBankFormatInputSchema } from "@smartfinance/contracts";
import { deleteBankFormat, getBankFormatByKey, listBankFormats, upsertBankFormat } from "@smartfinance/database";
import type { ApiBindings, ApiVariables } from "../env";
import { suggestBankFormatMappingWithAi } from "../services/ai";
import { jsonError } from "../utils/http";

const bankFormatsRouter = new Hono<{
  Bindings: ApiBindings;
  Variables: ApiVariables;
}>();

bankFormatsRouter.get("/", async (c) => {
  const auth = c.get("auth");
  const formats = await listBankFormats(c.env.DB, auth.userId);
  return c.json(formats.map((format) => bankFormatSchema.parse(format)));
});

bankFormatsRouter.get("/:key", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const format = await getBankFormatByKey(c.env.DB, auth.userId, c.req.param("key"));
  if (!format) {
    return jsonError("Bank format not found", "BANK_FORMAT_NOT_FOUND", requestId, 404);
  }

  return c.json(bankFormatSchema.parse(format));
});

bankFormatsRouter.post("/suggest", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const body = bankFormatSuggestionInputSchema.safeParse(await c.req.json());
  if (!body.success) {
    return jsonError("Invalid bank format suggestion payload", "VALIDATION_ERROR", requestId, 400);
  }

  const knownFormats = await listBankFormats(c.env.DB, auth.userId);
  const suggestion = await suggestBankFormatMappingWithAi(c.env, {
    formatKey: body.data.format_key ?? null,
    columns: body.data.columns,
    sampleRows: body.data.sample_rows,
    accountCurrency: body.data.account_currency ?? null,
    knownFormats: knownFormats.map((format) => ({
      bank_name: format.bank_name,
      col_fecha: format.col_fecha,
      col_desc: format.col_desc,
      col_debit: format.col_debit,
      col_credit: format.col_credit,
      col_monto: format.col_monto,
    })),
  });

  return c.json(bankFormatSuggestionSchema.parse(suggestion));
});

bankFormatsRouter.post("/", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const body = upsertBankFormatInputSchema.safeParse(await c.req.json());
  if (!body.success) {
    return jsonError("Invalid bank format payload", "VALIDATION_ERROR", requestId, 400);
  }

  const format = await upsertBankFormat(c.env.DB, auth.userId, body.data);
  return c.json(bankFormatSchema.parse(format), 201);
});

bankFormatsRouter.delete("/:key", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const result = await deleteBankFormat(c.env.DB, auth.userId, c.req.param("key"));
  if (!result.deleted) {
    return jsonError("Bank format not found", "BANK_FORMAT_NOT_FOUND", requestId, 404);
  }

  return c.json({ deleted: true });
});

export default bankFormatsRouter;
