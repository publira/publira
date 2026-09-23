# Seeds

Initial data for local development and UI checks, in two halves: the rows, as SQL, and the images those rows name, as files in object storage.

## Purpose

- Separate the responsibilities of migrations and seeds
- Reproduce the initial database state without a Go runtime
- Remain safe to run repeatedly (idempotent)

## The two halves

| Half | What it puts where | How it is run |
| --- | --- | --- |
| Database | Every row, the images included: the `*_images` and `*_image_variants` rows that describe each image and name the object key it is stored at | `task db:seed`, which is plain SQL through `psql` |
| Storage | The bytes, from `objects/` into the bucket, at the keys those rows name | `task storage:seed`, which reads the keys back out of the database |

The split is what keeps the database half runnable with nothing but `psql`: a seed that had to upload its own images would need a runtime to talk to S3. It is also why neither half is useful alone — a row naming an object that is not there leaves a broken image, and an object no row names is never served — so `task setup`, `task dev-env:init`, and `task e2e:db` all run both.

`objects/` mirrors the key space one directory deep: an object key is `tenants/<tenant>/seed/<path>`, and `<path>` is where the file sits under `objects/`. `task storage:seed` refuses to upload anything when the two sides disagree in either direction.

The files themselves are rendered from the vector sources under [`assets/`](../../assets/README.md) by `task images:gen`, so a redrawn card is an SVG edit and a re-render rather than a new JPEG.

## Directory layout

- `prod.sql`: **Production** entry point — database users, roles, and object ownership only
- `dev.sql`: **Development** entry point — `prod.sql` plus development sample data
- `baseline/`: Minimal files shared between environments (referenced by both prod and dev)
- `creator_roles.sql`: The creator-role vocabulary a tenant starts with, for the tenant a seed created (included with `\ir` from every seed that inserts a tenant, after `\set seed_tenant <public_id>`)
- `episode_creators.sql`: The credits of the episodes a seed wrote, copied from their series (included the same way from every seed that inserts an episode)
- `dev/`: Data used only in development (referenced only by dev.sql)
  - `001_tenant_users.sql`: Tenants, users, and roles
  - `010_catalog.sql`: Labels, creators, series, episodes, genres, and tags
  - `020_audit_logs.sql`: Audit logs
  - `030_smtp_config.sql`: SMTP configuration
  - `040_pages.sql`: Published pages
  - `050_access_tickets.sql`: The member's access ticket for the priced episode
  - `060_images.sql`: The image rows: an eye-catch for every series and label, an icon for every creator, and eight body pages for every episode
  - `070_follows.sql`: The member's series and author follows, which fill My Page's follow updates
  - `080_purchases.sql`: The member's purchases of the priced episode, one readable and one expired, which fill the purchase library
- `objects/`: The image files `task storage:seed` uploads, laid out as the keys `dev/060_images.sql` names
- `scenarios/`: Scenario-specific data (run as needed) — [scenarios/README.md](./scenarios/README.md)

## Running seeds

```bash
task db:seed             # Development seeds (default: ENV=dev)
task db:seed ENV=prod    # Production seeds (database users, roles, and object ownership only)
task storage:seed        # The images the development seed's rows name
```

`task db:setup` runs `db:migrate` and `db:seed` (dev). `task storage:seed` creates the bucket first, so it needs no separate `task storage:init`.

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
| `publira_outbox` | LOGIN, BYPASSRLS | Login user for the worker's Outbox drain; bypasses RLS to claim pending rows across every tenant, and owns River's schema |
| `publira_ticker` | LOGIN, BYPASSRLS | Login user for the three ticker batches; bypasses RLS to publish, apply free windows, and roll days across every tenant |
| `publira_admin` | LOGIN | Login user for the admin API; RLS enabled (tenant-scoped) |
| `publira_public` | LOGIN | Login user for the public API; RLS enabled (tenant-scoped) |

`publira_outbox` is the only one of them with `CREATE` on the `public` schema: the worker applies River's own schema (`river_job` and the rest) with `rivermigrate` at startup.

`publira_ticker` is the only one of them without the blanket table grants the others share. Its jobs touch a known set of catalog, follow, and recipient tables, so the seed names those tables one by one and leaves the role out of the `ALTER DEFAULT PRIVILEGES` that hands every future table to the rest.

The same file takes the blanket grants back from two families of table — every `platform_*` relation, from the tenant-scoped and worker roles, and the writes on `episode_rating_counts` and `series_rating_counts`, from `publira_admin` and `publira_public` — and creates the `publira_take_back_default_grants` event trigger, which applies the same rule to each relation a later migration creates. A database that receives migrations after the seed ran therefore needs no second seed run to keep them.

`baseline/010_river_object_owner.sql` follows it and hands any existing `river_*` table, sequence, enum, or function to `publira_outbox`. On a database the worker has always connected to as that role there is nothing to move; on one whose River schema another role created, the transfer is what keeps `rivermigrate` able to alter those objects on the next River release.

The development passwords are `platformpass`, `contentstatspass`, `outboxpass`, `tickerpass`, `adminpass`, and `publicpass`. After seeding a production environment, change them to secure values with `ALTER ROLE ... PASSWORD`.

## Development data counts

- labels: 10
- series: 100
- episodes: 1,000 (10 per series)
- eye-catches: one per series and per label, in each of the four delivered aspect ratios at three widths
- creator icons: one per creator
- episode pages: 8 per episode

Five card designs and five icon designs are dealt round-robin over the catalogue, so a shelf tells one series from the next while the whole set stays at 73 uploaded objects.

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
