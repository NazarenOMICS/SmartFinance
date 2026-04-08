import type { MiddlewareHandler } from "hono";
import type { ApiBindings, ApiVariables } from "../env";
import { createRequestId, log } from "@smartfinance/observability";

export const requestContextMiddleware: MiddlewareHandler<{
  Bindings: ApiBindings;
  Variables: ApiVariables;
}> = async (c, next) => {
  const requestId = createRequestId();
  c.set("requestId", requestId);

  await next();

  log("info", "request.completed", {
    request_id: requestId,
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
  });
};
