import { Hono } from "hono";
import { monthStringSchema } from "@smartfinance/contracts";
import { getUsageSnapshot, listTransactionsByMonth } from "@smartfinance/database";
import type { ApiBindings, ApiVariables } from "../env";
import { jsonError } from "../utils/http";

const exportRouter = new Hono<{
  Bindings: ApiBindings;
  Variables: ApiVariables;
}>();

function escapeCsv(value: unknown) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

exportRouter.get("/csv", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const parsedMonth = monthStringSchema.safeParse(c.req.query("month"));
  if (!parsedMonth.success) {
    return jsonError("month query param is required", "VALIDATION_ERROR", requestId, 400);
  }

  const usage = await getUsageSnapshot(c.env.DB, auth.userId);
  if (!usage.capabilities.exports_enabled) {
    return jsonError("CSV export is available on paid plans", "EXPORT_LIMIT_REACHED", requestId, 403);
  }

  const rows = await listTransactionsByMonth(c.env.DB, auth.userId, parsedMonth.data);
  const csvRows = [
    ["fecha", "descripcion_banco", "descripcion_usuario", "monto", "moneda", "categoria", "cuenta", "tipo_gasto", "es_cuota"].join(","),
    ...rows.map((row) => [
      escapeCsv(row.fecha),
      escapeCsv(row.desc_banco),
      escapeCsv(row.desc_usuario),
      escapeCsv(row.monto),
      escapeCsv(row.moneda),
      escapeCsv(row.category_name),
      escapeCsv(row.account_name),
      escapeCsv(row.category_type),
      escapeCsv(row.es_cuota),
    ].join(",")),
  ].join("\n");

  return new Response(csvRows, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="smartfinance-${parsedMonth.data}.csv"`,
    },
  });
});

export default exportRouter;
