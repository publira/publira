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
