import type { MiddlewareHandler } from "hono";
import { consumeRateLimit } from "@smartfinance/database";
import type { ApiBindings, ApiVariables } from "../env";

function getSubject(c: Parameters<MiddlewareHandler<{ Bindings: ApiBindings; Variables: ApiVariables }>>[0]) {
  const auth = c.get("auth");
  if (auth?.userId) return `user:${auth.userId}`;

  const forwarded = c.req.header("CF-Connecting-IP")
    || c.req.header("x-forwarded-for")
    || "unknown";
  return `ip:${String(forwarded).split(",")[0].trim()}`;
}

export function createRateLimitMiddleware(input: {
  metric: string;
  limit: number;
  windowSeconds: number;
  code?: string;
  message?: string;
}) {
  const errorCode = input.code || "RATE_LIMITED";
  const errorMessage = input.message || "Too many requests";

  const middleware: MiddlewareHandler<{
    Bindings: ApiBindings;
    Variables: ApiVariables;
  }> = async (c, next) => {
    const requestId = c.get("requestId");
    const result = await consumeRateLimit(
      c.env.DB,
      getSubject(c),
      `rate_limit:${input.metric}`,
      input.limit,
      input.windowSeconds,
    );

    if (!result.allowed) {
      c.header("Retry-After", String(result.retry_after_seconds));
      return c.json(
        {
          error: errorMessage,
          code: errorCode,
          request_id: requestId,
        },
        429,
      );
    }

    await next();
  };

  return middleware;
}
