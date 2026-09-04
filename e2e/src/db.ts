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
 *
 * Engagement events do not cascade either: `content_events` references both
 * series and episodes with `ON DELETE RESTRICT`, so a view or rating row
 * survives the content it describes on purpose. The app never deletes a series,
 * so only this fixture — which reaches past the app and drops rows directly —
 * has to clear the log first. Every event carries its series, whether or not it
 * also names an episode, so one delete by `series_id` covers them all.
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
    BEGIN;
    -- An insert into content_events takes a KEY SHARE lock for its series FK.
    -- Locking the parent first waits for an in-flight insert, then keeps later
    -- inserts out until the series and every event that references it are gone.
    SELECT s.id
    FROM series s
    WHERE s.public_id IN (${list})
    FOR UPDATE;
    DELETE FROM content_events ce
    USING series s
    WHERE ce.series_id = s.id
      AND s.public_id IN (${list});
    DELETE FROM episodes e
    USING series s
    WHERE e.series_id = s.id
      AND s.public_id IN (${list});
    DELETE FROM series
    WHERE public_id IN (${list});
    COMMIT;
  `);
};

/**
 * Remove labels created by admin tests.
 *
 * A label's images and image variants cascade from it. A series does not, so
 * this is only for labels no series was attached to — the eye-catch suite
 * creates one per test and never gives it a series.
 */
export const deleteLabelsByPublicIds = (publicIds: readonly string[]): void => {
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
  runSql(`DELETE FROM labels WHERE public_id IN (${quoted.join(", ")});`);
};

/**
 * Remove pages created by admin published-page tests.
 *
 * `page_versions` cascade from the page, and `pages.published_version_id`
 * is `ON DELETE SET NULL` against a row that is going away with it, so one
 * delete clears the whole page.
 */
export const deletePagesByIds = (ids: readonly string[]): void => {
  const quoted: string[] = [];
  for (const id of ids) {
    const trimmed = id.trim();
    if (trimmed.length > 0) {
      quoted.push(quoteSqlLiteral(trimmed));
    }
  }
  if (quoted.length === 0) {
    return;
  }
  runSql(`DELETE FROM pages WHERE id IN (${quoted.join(", ")});`);
};

/**
 * Remove tenants created by platform tenant-ops tests.
 * Most tenant-scoped tables cascade; series does not, so wipe empty
 * series/episodes first for safety. Platform audit log rows keep their
 * target_id text (no FK to tenants).
 *
 * `content_events` would cascade from the tenant, but the series and episode
 * deletes run before that and both restrict, so the log has to go first here
 * too.
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
    BEGIN;
    -- Lock the tenant before its series. This blocks new series and
    -- content_events rows from referencing the fixture while it is removed.
    SELECT t.id
    FROM tenants t
    WHERE t.public_id IN (${list})
    FOR UPDATE;
    SELECT s.id
    FROM series s
    JOIN tenants t ON t.id = s.tenant_id
    WHERE t.public_id IN (${list})
    FOR UPDATE OF s;
    DELETE FROM content_events ce
    USING tenants t
    WHERE ce.tenant_id = t.id
      AND t.public_id IN (${list});
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
    COMMIT;
  `);
};

/**
 * Remove platform operators created through the console, by email address.
 *
 * `DeactivateOperator` is a status change, so the console never removes a row
 * and a suite that invites operators has to. Their audit rows go first:
 * `platform_audit_logs.actor_platform_user_id` restricts rather than cascades,
 * which is what keeps an operator's trail from disappearing with the account.
 */
export const deletePlatformOperatorsByEmails = (
  emails: readonly string[]
): void => {
  const quoted: string[] = [];
  for (const email of emails) {
    const trimmed = email.trim();
    if (trimmed.length > 0) {
      quoted.push(quoteSqlLiteral(trimmed));
    }
  }
  if (quoted.length === 0) {
    return;
  }
  const list = quoted.join(", ");
  runSql(`
    BEGIN;
    DELETE FROM platform_audit_logs pal
    USING platform_users pu
    WHERE pal.actor_platform_user_id = pu.id
      AND pu.email IN (${list});
    DELETE FROM platform_users
    WHERE email IN (${list});
    COMMIT;
  `);
};

/**
 * Leave the platform with no operator at all — the one state `/setup` renders
 * in, since `CheckSetupStatus` reports setup as complete as soon as a single
 * `platform_users` row exists.
 *
 * The audit log goes first for the same restricting foreign key
 * {@link deletePlatformOperatorsByEmails} works around, and `platform_config`
 * goes too: a platform that has never been set up has saved no default
 * language, and leaving the seeded row behind would let a spec assert a saved
 * language that was already there before the setup form chose one.
 *
 * Only `e2e/tests/platform.setup.spec.ts` may call this, and only from the
 * isolated `platform-setup` project that runs after every other one:
 * every console screen in the suite needs an operator to sign in as.
 * `db/seeds/scenarios/110_platform_setup.sql` puts the seeded rows back.
 */
export const emptyPlatformOperators = (): void => {
  runSql(`
    BEGIN;
    DELETE FROM platform_audit_logs;
    DELETE FROM platform_users;
    DELETE FROM platform_config;
    COMMIT;
  `);
};
