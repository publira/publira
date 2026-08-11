import { execFileSync } from "node:child_process";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "../..");

// Absolute path avoids PATH lookup (oxlint sonarjs/no-os-command-from-path).
const psqlBin = (): string => process.env.PSQL_BIN?.trim() || "/usr/bin/psql";

const resolveDbUrl = (): string => {
  const url = process.env.PUBLIRA_DB_URL?.trim();
  if (!url) {
    throw new Error(
      "PUBLIRA_DB_URL is required to apply scenario SQL (set by e2e scripts)"
    );
  }
  return url;
};

/**
 * Apply a scenario seed under `db/seeds/scenarios/<name>.sql`.
 * Scenarios are optional and independent of the baseline/dev seed.
 */
export const applyScenarioSql = (name: string): void => {
  const normalized = name.trim().replace(/\.sql$/u, "");
  if (!normalized || normalized.includes("/") || normalized.includes("..")) {
    throw new Error(`invalid scenario name: ${name}`);
  }

  const sqlPath = path.join(
    repoRoot,
    "db",
    "seeds",
    "scenarios",
    `${normalized}.sql`
  );

  execFileSync(
    psqlBin(),
    [resolveDbUrl(), "-v", "ON_ERROR_STOP=1", "-f", sqlPath],
    {
      stdio: "inherit",
    }
  );
};

/**
 * Run a short SQL statement against the E2E Postgres (superuser URL).
 * Prefer scenario files for multi-statement fixtures; use this for one-shot
 * nudges (e.g. advancing a scheduled_at so the publish worker can pick it up).
 */
export const runSql = (sql: string): void => {
  const statement = sql.trim();
  if (!statement) {
    throw new Error("runSql requires a non-empty SQL statement");
  }

  execFileSync(
    psqlBin(),
    [resolveDbUrl(), "-v", "ON_ERROR_STOP=1", "-c", statement],
    {
      stdio: "inherit",
    }
  );
};

/**
 * Run a SQL statement and return stdout (trimmed). Throws when psql exits
 * non-zero. Use for scalar checks in polls where inherit noise is unwanted.
 */
export const querySql = (sql: string): string => {
  const statement = sql.trim();
  if (!statement) {
    throw new Error("querySql requires a non-empty SQL statement");
  }

  return execFileSync(
    psqlBin(),
    [resolveDbUrl(), "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", statement],
    {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  ).trim();
};

const quoteSqlLiteral = (value: string): string =>
  `'${value.replaceAll("'", "''")}'`;

/**
 * Remove series created by admin publish-flow tests (and their episodes).
 * Episodes do not cascade from series, so they are deleted first. Listings /
 * creators cascade from their parents.
 */
export const deleteSeriesByPublicIds = (publicIds: readonly string[]): void => {
  const quoted: string[] = [];
  for (const publicId of publicIds) {
    const trimmed = publicId.trim();
    if (trimmed.length > 0) {
      quoted.push(quoteSqlLiteral(trimmed));
    }
  }
  if (quoted.length === 0) {
    return;
  }
  const list = quoted.join(", ");
  runSql(`
    DELETE FROM episodes e
    USING series s
    WHERE e.series_id = s.id
      AND s.public_id IN (${list});
    DELETE FROM series
    WHERE public_id IN (${list});
  `);
};

/**
 * Remove tenants created by platform tenant-ops tests.
 * Most tenant-scoped tables cascade; series does not, so wipe empty
 * series/episodes first for safety. Platform audit log rows keep their
 * target_id text (no FK to tenants).
 */
export const deleteTenantsByPublicIds = (
  publicIds: readonly string[]
): void => {
  const quoted: string[] = [];
  for (const publicId of publicIds) {
    const trimmed = publicId.trim();
    if (trimmed.length > 0) {
      quoted.push(quoteSqlLiteral(trimmed));
    }
  }
  if (quoted.length === 0) {
    return;
  }
  const list = quoted.join(", ");
  runSql(`
    DELETE FROM episodes e
    USING series s, tenants t
    WHERE e.series_id = s.id
      AND s.tenant_id = t.id
      AND t.public_id IN (${list});
    DELETE FROM series s
    USING tenants t
    WHERE s.tenant_id = t.id
      AND t.public_id IN (${list});
    DELETE FROM tenants
    WHERE public_id IN (${list});
  `);
};
