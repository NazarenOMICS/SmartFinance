import { firstRow, runStatement, type D1DatabaseLike } from "./client";

function currentWindow(windowSeconds: number, now = new Date()) {
  const timestamp = Math.floor(now.getTime() / 1000);
  const bucketStart = timestamp - (timestamp % windowSeconds);
  return new Date(bucketStart * 1000).toISOString().slice(0, 19);
}

export async function consumeRateLimit(
  db: D1DatabaseLike,
  subject: string,
  metric: string,
  limit: number,
  windowSeconds: number,
) {
  const period = currentWindow(windowSeconds);

  await runStatement(
    db,
    `
      INSERT INTO usage_counters (user_id, metric, period, value)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(user_id, metric, period)
      DO UPDATE SET value = usage_counters.value + 1
    `,
    [subject, metric, period],
  );

  const row = await firstRow<{ value: number }>(
    db,
    `
      SELECT value
      FROM usage_counters
      WHERE user_id = ? AND metric = ? AND period = ?
      LIMIT 1
    `,
    [subject, metric, period],
  );

  const used = Number(row?.value || 0);
  return {
    allowed: used <= limit,
    used,
    limit,
    retry_after_seconds: windowSeconds,
  };
}
