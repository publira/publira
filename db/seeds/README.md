# SQL Seeds

Initial data for local development and UI checks is managed as SQL.

## Purpose

- Separate the responsibilities of migrations and seeds
- Reproduce the initial database state without a Go runtime
- Remain safe to run repeatedly (idempotent)

## Directory layout

- `prod.sql`: **Production** entry point — database users, roles, and object ownership only
- `dev.sql`: **Development** entry point — `prod.sql` plus development sample data
- `baseline/`: Minimal files shared between environments (referenced by both prod and dev)
- `dev/`: Data used only in development (referenced only by dev.sql)
  - `001_tenant_users.sql`: Tenants, users, and roles
  - `010_catalog.sql`: Labels, creators, series, and episodes
  - `020_audit_logs.sql`: Audit logs
  - `030_smtp_config.sql`: SMTP configuration
- `scenarios/`: Scenario-specific data (run as needed) — [scenarios/README.md](./scenarios/README.md)

## Running seeds

```bash
task db:seed             # Development seeds (default: ENV=dev)
task db:seed ENV=prod    # Production seeds (database users, roles, and object ownership only)
```

`task db:setup` runs `db:migrate` and `db:seed` (dev).

## Principles

- Add schema changes only to migrations
- Limit seeds to fixed development data and reference data
- Keep seeds idempotent with `ON CONFLICT`

## Development sample accounts

- Platform:
  - email: `platform@example.com`
  - password: `platformpass`
- Tenant admin:
  - tenant domain: `localhost`
  - tenant admin domain: `admin.localhost`
  - email: `admin@example.com`
  - password: `adminpass`
- Member user:
  - email: `member@example.com`
  - password: `memberpass`

## Baseline roles and users

`baseline/000_rls_bypass_role.sql` creates the following idempotently:

| Name | Type | Purpose |
| --- | --- | --- |
| `publira_rls_bypass` | NOLOGIN, BYPASSRLS | Named privilege used to grant a dedicated role in production |
| `publira_platform` | LOGIN, BYPASSRLS | Login user for the platform API; bypasses RLS to access every tenant |
| `publira_content_stats` | LOGIN, BYPASSRLS | Login user for the daily stats batches; bypasses RLS to aggregate across every tenant |
| `publira_outbox` | LOGIN, BYPASSRLS | Login user for outbox-worker; bypasses RLS to claim pending rows across every tenant, and owns River's schema |
| `publira_admin` | LOGIN | Login user for the admin API; RLS enabled (tenant-scoped) |
| `publira_public` | LOGIN | Login user for the public API; RLS enabled (tenant-scoped) |

`publira_outbox` is the only one of them with `CREATE` on the `public` schema: outbox-worker applies River's own schema (`river_job` and the rest) with `rivermigrate` at startup.

`baseline/010_river_object_owner.sql` follows it and hands any existing `river_*` table, sequence, enum, or function to `publira_outbox`. On a database the worker has always connected to as that role there is nothing to move; on one whose River schema another role created, the transfer is what keeps `rivermigrate` able to alter those objects on the next River release.

The development passwords are `platformpass`, `contentstatspass`, `outboxpass`, `adminpass`, and `publicpass`. After seeding a production environment, change them to secure values with `ALTER ROLE ... PASSWORD`.

## Development data counts

- labels: 10
- series: 100
- episodes: 1,000 (10 per series)

## ID specification

- `public_id`: A standard 12-character Base58 value (the same format as `server/internal/publicid`)
- `id` (UUID): A value conforming to the UUIDv7 format

Seed `public_id` values are fixed rather than derived from primary-key UUIDs. Their format is `Seed`, a four-character type, and a four-digit sequence number. Because Base58 has no `0`, each zero in the sequence is replaced with `A` (`scenarios/` uses `Bndr` instead of `Seed`).

| Type                   | Example                                         |
| ---------------------- | ----------------------------------------------- |
| tenants                | `SeedTNNTAAA1`                                  |
| platform_users         | `SeedPFUSAAA1`                                  |
| users (admin / member) | `SeedADMNAAA1` / `SeedMMBRAAA1`                 |
| labels                 | `SeedLABLAAA1` … `SeedLABLAA1A` (10 entries)    |
| creators               | `SeedAUTHAAA1` … `SeedAUTHA1AA` (100 entries)   |
| series                 | `SeedSERSAAA1` … `SeedSERSA1AA` (100 entries)   |
| episodes               | `SeedEPSDAAA1` … `SeedEPSD1AAA` (1,000 entries) |
| access_tickets         | `SeedTCKTAAA1`                                  |

`public_id` is case-sensitive. Keep values referenced from E2E tests aligned with `e2e/src/scenarios/multi-tenant.ts`.

An existing local database created with the old format (the first 12 hexadecimal characters of a UUID) will encounter primary-key conflicts because `ON CONFLICT (public_id)` does not match. Re-create it with `task db:reset`.
