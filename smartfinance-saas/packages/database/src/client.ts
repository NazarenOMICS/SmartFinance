import { SCHEMA_VERSION } from "./schema";

export type D1Row = Record<string, unknown>;

export type D1PreparedResult<T extends D1Row = D1Row> = {
  results: T[];
};

export type D1RunResult = {
  success: boolean;
  meta?: {
    changes?: number;
    last_row_id?: number;
  };
};

export type D1PreparedStatement = {
  bind(...values: unknown[]): {
    all<T extends D1Row = D1Row>(): Promise<D1PreparedResult<T>>;
    first<T extends D1Row = D1Row>(): Promise<T | null>;
    run(): Promise<D1RunResult>;
  };
};

export type D1DatabaseLike = {
  prepare(sql: string): D1PreparedStatement;
};

export async function allRows<T extends D1Row = D1Row>(
  db: D1DatabaseLike,
  sql: string,
  values: unknown[] = []
): Promise<T[]> {
  const result = await db.prepare(sql).bind(...values).all<T>();
  return result.results;
}

export async function firstRow<T extends D1Row = D1Row>(
  db: D1DatabaseLike,
  sql: string,
  values: unknown[] = []
): Promise<T | null> {
  return db.prepare(sql).bind(...values).first<T>();
}

export async function runStatement(
  db: D1DatabaseLike,
  sql: string,
  values: unknown[] = []
): Promise<D1RunResult> {
  return db.prepare(sql).bind(...values).run();
}

export async function getSchemaStatus(db: D1DatabaseLike) {
  const row = await firstRow<{ value: string }>(
    db,
    "SELECT value FROM system_meta WHERE key = ? LIMIT 1",
    ["schema_version"]
  );
  const currentVersion = row?.value ?? null;

  return {
    ok: currentVersion === SCHEMA_VERSION,
    expected_version: SCHEMA_VERSION,
    current_version: currentVersion,
    blocking_reason: currentVersion === SCHEMA_VERSION
      ? null
      : currentVersion
        ? "database_schema_outdated"
        : "schema_version_missing",
  };
}

export async function assertSchemaVersion(db: D1DatabaseLike) {
  const status = await getSchemaStatus(db);
  if (!status.ok) {
    const error = new Error("Database schema is not up to date.");
    Object.assign(error, { status: 503, code: "SCHEMA_MISMATCH", schema: status });
    throw error;
  }
  return status;
}
