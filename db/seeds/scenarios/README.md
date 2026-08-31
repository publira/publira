# Scenarios

This directory holds scenario seeds for UI checks and E2E tests. They are separate from baseline and development seeds, and each runs **only when needed**.

## Principles

- File name: `<nnn>_<slug>.sql` or `<slug>.sql` (for example, `010_multi_tenant.sql`)
- A scenario seed contains only idempotent DML. Use `ON CONFLICT` and an ID range that does not break the shared development seeds
- Do not put DDL here. At this stage, place schema changes in `db/migrations/00000000000000_baseline.up.sql` and its matching down migration

## Applying a scenario

### Manually

```bash
# Example using the E2E Compose Postgres instance (the port is the e2e/compose.yaml default)
export PUBLIRA_DB_URL="${PUBLIRA_DB_URL:-postgres://postgres:password@127.0.0.1:5433/publira?sslmode=disable}"
psql "${PUBLIRA_DB_URL:?Set PUBLIRA_DB_URL to the target database URL}" \
  -v ON_ERROR_STOP=1 \
  -f db/seeds/scenarios/010_multi_tenant.sql
```

### From E2E (Playwright)

1. After starting the stack and running `task e2e:db`, call it in a test:

```ts
import { applyScenarioSql } from "../src/db";

test.beforeAll(() => {
  applyScenarioSql("010_multi_tenant"); // → db/seeds/scenarios/010_multi_tenant.sql
});
```

2. The E2E scripts set `PUBLIRA_DB_URL`. When running `pnpm exec playwright test` alone, export the same URL.

For detailed E2E operation, see [e2e/README.md](../../../e2e/README.md).

## List

| File | Description |
| --- | --- |
| `010_multi_tenant.sql` | Adds a second tenant, `other.localhost` / `Boundary Tenant`, alongside the development seed's `localhost` / `Seed Tenant`. It has one published series (two published episodes and one unpublished scheduled episode) and one unpublished series, and is used to verify tenant boundaries and publication decisions (`e2e/tests/catalog.tenant-boundary.spec.ts`). Its record `public_id` values are constants in `e2e/src/scenarios/multi-tenant.ts` |
| `020_member_announcements.sql` | Seed for member-announcement pagination (`e2e/tests/announcements.pagination.spec.ts`) |
| `030_platform_operators.sql` | Adds a limited `platform_operator`, `platform-operator@example.com` / `platformpass` (public_id `ScenPFUSAAA1`), in addition to the development seed's super admin. Used to verify permissions by role (`e2e/tests/platform.tenant-ops.spec.ts`). Constants are in `e2e/src/scenarios/platform-tenants.ts` |
| `040_auth_e2e.sql` | Accounts used only by authentication E2E tests. Adds `auth-admin@example.com`, `auth-member@example.com`, and `auth-platform@example.com` so that bumping `credentials_version` does not break development-seed sessions (`e2e/tests/admin.auth.spec.ts` / `host.auth.spec.ts` / `platform.auth.spec.ts`). Constants are in `e2e/src/scenarios/auth.ts` |
