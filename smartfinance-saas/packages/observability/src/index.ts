import { createRequestId } from "./request-id";

export type LogLevel = "info" | "error";

export function log(level: LogLevel, message: string, fields: Record<string, unknown> = {}): void {
  const payload = {
    level,
    message,
    ...fields
  };

  if (level === "error") {
    console.error(JSON.stringify(payload));
    return;
  }

  console.log(JSON.stringify(payload));
}

export { createRequestId };
