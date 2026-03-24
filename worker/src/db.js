// Wraps Cloudflare D1 to match the better-sqlite3 interface used in routes.
// All methods are async (D1 is always async).
export function getDb(env) {
  return {
    prepare(sql) {
      return {
        async all(...params) {
          const stmt = params.length ? env.DB.prepare(sql).bind(...params) : env.DB.prepare(sql);
          const result = await stmt.all();
          return result.results;
        },
        async get(...params) {
          const stmt = params.length ? env.DB.prepare(sql).bind(...params) : env.DB.prepare(sql);
          return stmt.first();
        },
        async run(...params) {
          const stmt = params.length ? env.DB.prepare(sql).bind(...params) : env.DB.prepare(sql);
          const result = await stmt.run();
          return {
            lastInsertRowid: result.meta.last_row_id,
            changes: result.meta.changes
          };
        }
      };
    },
    async exec(sql) {
      return env.DB.exec(sql);
    }
  };
}

export function monthWindow(month) {
  const [year, monthIndex] = month.split("-").map(Number);
  const start = `${year}-${String(monthIndex).padStart(2, "0")}-01`;
  const nextMonth = monthIndex === 12 ? 1 : monthIndex + 1;
  const nextYear = monthIndex === 12 ? year + 1 : year;
  const end = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
  return { start, end };
}

export async function getSettingsObject(env) {
  const rows = await env.DB.prepare("SELECT key, value FROM settings").all();
  return rows.results.reduce((acc, row) => {
    acc[row.key] = row.value;
    return acc;
  }, {});
}

export async function upsertSetting(env, key, value) {
  return env.DB.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).bind(key, String(value)).run();
}
