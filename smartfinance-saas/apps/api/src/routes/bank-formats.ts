import { Hono } from "hono";
import { bankFormatSchema, upsertBankFormatInputSchema } from "@smartfinance/contracts";
import { deleteBankFormat, getBankFormatByKey, listBankFormats, upsertBankFormat } from "@smartfinance/database";
import type { ApiBindings, ApiVariables } from "../env";
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
