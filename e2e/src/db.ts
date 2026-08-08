import { execFileSync } from "node:child_process";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "../..");

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

  // Absolute path avoids PATH lookup (oxlint sonarjs/no-os-command-from-path).
  const psqlBin = process.env.PSQL_BIN?.trim() || "/usr/bin/psql";

  execFileSync(
    psqlBin,
    [resolveDbUrl(), "-v", "ON_ERROR_STOP=1", "-f", sqlPath],
    {
      stdio: "inherit",
    }
  );
};
