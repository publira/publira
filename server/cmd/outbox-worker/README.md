# outbox-worker

A long-lived worker that drains the Outbox and processes the entries as River jobs. It runs as a separate process from the API processes. Besides `outbox_test`, it handles these email events:

| Event type | Mail |
| --- | --- |
| `tenant_admin_invitation_email` | Tenant administrator invitation |
| `platform_password_reset_email` | Platform Console password reset |
| `platform_email_change_confirmation_email` | Platform Console email change confirmation, one event per address to confirm |
| `platform_email_changed_notice_email` | Platform Console notice to the previous address once the change completes |
| `reader_email_verification_email` | Reader sign-up address verification |
| `reader_email_change_confirmation_email` | Reader email change confirmation, one event per address to confirm |
| `reader_email_changed_notice_email` | Reader notice to the previous address once the change completes |
| `reader_password_reset_email` | Reader password reset |
| `admin_password_reset_email` | Admin console password reset |
| `admin_email_change_confirmation_email` | Admin console email change confirmation, one event per address to confirm |
| `admin_email_changed_notice_email` | Admin console notice to the previous address once the change completes |

The platform console rows carry no `tenant_id`: their handlers resolve the platform SMTP settings and the platform default locale and time zone rather than a tenant's. The reader and admin console rows name a tenant: the reader links point at that tenant's own domain, and the admin console links at its admin domain.

## Running

From the repository root:

```bash
task server:dev-outbox-worker
```

From the `server` directory:

```bash
go run ./cmd/outbox-worker
```

Using a pre-built binary:

```bash
task server:build
./server/bin/outbox-worker
```

The production image uses the API role (a long-lived HTTP process).

```bash
task docker:build:api CMD_NAME=outbox-worker PORT=8003
```

## Main environment variables

In production the connection must use `publira_outbox`, the BYPASSRLS login the baseline seed creates for this process; locally the fallbacks below land on the superuser connection, which bypasses RLS as well.

- `PUBLIRA_WORKER_DB_URL` (optional; falls back to `PUBLIRA_DB_URL`, and otherwise to the development default `postgres://postgres:password@db:5432/publira?sslmode=disable`)
- `PUBLIRA_WORKER_ADDR` (optional, default `:8003`. Serves `/livez` and `/readyz`)
- `PUBLIRA_OUTBOX_DRAIN_INTERVAL` (optional, a Go duration. Default `2s`)
- `PUBLIRA_OUTBOX_CLAIM_LIMIT` (optional, the maximum number of rows claimed per drain. Default `100`)
- `PUBLIRA_OUTBOX_MAX_ATTEMPTS` (optional, default `10`. The failure count at which an entry becomes `dead`)
- `PUBLIRA_OUTBOX_STALE_PROCESSING` (optional, a Go duration. Default `15m`. A `processing` row older than this is returned to `pending`)
- `PUBLIRA_OUTBOX_MAX_WORKERS` (optional, the concurrency of River's default queue. Default `8`)
- `PUBLIRA_EMAIL_RENDERER_URL` (optional, the URL of the email-renderer that renders the emails above. `http://localhost:8080` when unset)
- `PUBLIRA_PLATFORM_APP_URL` (optional, the base URL the Platform Console links in the platform auth mail are built from. `http://platform.localhost:3080` when unset)
- `PUBLIRA_SECRET_ENCRYPTION_KEYS` / `PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID` (optional, the keys used to decrypt the SMTP password. Set the same values as the platform API)
- `PUBLIRA_TRACING_ENABLED` (optional, disabled by default)
- `PUBLIRA_DEPLOYMENT_ENVIRONMENT` (optional, `development` when unset)

The trace attributes, span naming, sampling, and the list of `OTEL_*` variables are in [server/README.md](../../README.md#distributed-tracing-opentelemetry).

River's schema (`river_job` and the rest) is applied with `rivermigrate` at startup, which is why `publira_outbox` holds `CREATE` on the `public` schema.

## Logs and metrics

The structured logs (slog) carry `event_id` / `event_type` / `idempotency_key` / `attempts`. The OpenTelemetry counters are:

- `publira.outbox.events.claimed`
- `publira.outbox.events.done`
- `publira.outbox.events.retry`
- `publira.outbox.events.dead`
- `publira.outbox.handler.duration` (histogram, seconds)

They are no-ops when there is no MeterProvider.

## Processing flow

1. Claim due `pending` rows with `FOR UPDATE SKIP LOCKED` and enqueue the River jobs in the same transaction
2. The job runs the handler: `done` on success, or back to `pending` with exponential backoff on failure
3. `dead` on reaching the maximum attempt count or on a permanent error
4. After a process restart, unprocessed `pending` rows and stale `processing` rows are picked up again
