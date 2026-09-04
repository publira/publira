# Scenarios

This directory holds scenario seeds for UI checks and E2E tests. They are separate from baseline and development seeds, and each runs **only when needed**.

## Principles

- File name: `<nnn>_<slug>.sql` or `<slug>.sql` (for example, `010_multi_tenant.sql`)
- A scenario seed contains only idempotent DML. Use `ON CONFLICT` and an ID range that does not break the shared development seeds
- Do not put DDL here. Schema changes go in a new migration under `db/migrations/` — see [`db/AGENTS.md`](../../AGENTS.md)

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
| `050_viewer_pages.sql` | Gives the development seed's free episode `Seed Episode 001-02` (`SeedEPSDAAA2`) eight body images — not the series' first episode, whose empty body other suites assert on — so the canvas viewer has pages to fetch, decode, and draw (`e2e/tests/host.viewer-performance.spec.ts`). Unlike the scenarios above it is not applied from a test: the rows are useless without the matching objects in storage, so `e2e/scripts/seed-viewer-pages.sh` applies it and uploads `e2e/fixtures/viewer-pages/*.jpg` to the object keys it names, and `task e2e:db` runs that script for the whole stack. Constants are in `e2e/src/scenarios/viewer-pages.ts` |
| `060_notification_inbox.sql` | Adds `notify.localhost` / `admin.notify.localhost` / `Notify Tenant` with one admin (`notify-admin@example.com`) and one member (`notify-member@example.com`). Publishing an episode notifies every member and every admin of that episode's tenant, so the specs that assert an empty notification bell (`e2e/tests/host.notifications.spec.ts` / `admin.notifications.spec.ts`) use a tenant that owns no series instead of the development seed accounts `admin.publish-flow` delivers to. Both specs apply it themselves, the way the scenarios before `050_viewer_pages.sql` do. Constants are in `e2e/src/scenarios/notification-inbox.ts` |
| `070_member_settings.sql` | Adds `settings-member@example.com` / `memberpass` (public_id `MsetMMBRAAA1`) to the development seed tenant. The member area E2E (`e2e/tests/host.member-settings.spec.ts`) renames the reader, switches their email notifications off, and follows a series, none of which the development seed member can absorb while `host.auth` signs in with its address and `announcements.pagination` reads its list. The spec applies the file before and after itself, so every statement in it either writes the starting value or deletes the rows the spec creates. Constants are in `e2e/src/scenarios/member-settings.ts` |
| `080_locale_switching.sql` | Adds `locale.localhost` / `admin.locale.localhost` / `Locale Tenant` (public_id `LangTNNTAAA1`), whose saved default locale is `en`. Every other seeded tenant saves `ja`, so this is the tenant that separates "what the tenant stored" from "a language this build falls back to": its public site serves English with no locale prefix and keeps `/ja/…`, and its console login screen — no session, so no `publira_locale` cookie — opens in English (`e2e/tests/host.locale-switching.spec.ts` / `admin.locale-switching.spec.ts`). It owns no series and no users. Constants are in `e2e/src/scenarios/locale-switching.ts` |
