# outbox-worker

A long-lived worker that drains the Outbox and processes the entries as River jobs. It runs as a separate process from the API processes. In addition to `outbox_test`, it handles the tenant administrator invitation email `tenant_admin_invitation_email`.

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

The connection must use a role **equivalent to BYPASSRLS**. `publira_admin` / `publira_public`, which carry tenant RLS, cannot claim pending rows across tenants.

- `PUBLIRA_WORKER_DB_URL` (optional; falls back to `PUBLIRA_DB_URL`, and otherwise to the development default `postgres://postgres:password@db:5432/publira?sslmode=disable`)
- `PUBLIRA_WORKER_ADDR` (optional, default `:8003`. Serves `/livez` and `/readyz`)
- `PUBLIRA_OUTBOX_DRAIN_INTERVAL` (optional, a Go duration. Default `2s`)
- `PUBLIRA_OUTBOX_CLAIM_LIMIT` (optional, the maximum number of rows claimed per drain. Default `100`)
- `PUBLIRA_OUTBOX_MAX_ATTEMPTS` (optional, default `10`. The failure count at which an entry becomes `dead`)
- `PUBLIRA_OUTBOX_STALE_PROCESSING` (optional, a Go duration. Default `15m`. A `processing` row older than this is returned to `pending`)
- `PUBLIRA_OUTBOX_MAX_WORKERS` (optional, the concurrency of River's default queue. Default `8`)
- `PUBLIRA_EMAIL_RENDERER_URL` (optional, the URL of the email-renderer that renders tenant administrator invitation emails. `http://localhost:8080` when unset)
- `PUBLIRA_SECRET_ENCRYPTION_KEYS` / `PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID` (optional, the keys used to decrypt the SMTP password. Set the same values as the platform API)
- `PUBLIRA_TRACING_ENABLED` (optional, disabled by default)
- `PUBLIRA_DEPLOYMENT_ENVIRONMENT` (optional, `development` when unset)

The trace attributes, span naming, sampling, and the list of `OTEL_*` variables are in [server/README.md](../../README.md#distributed-tracing-opentelemetry).

River's schema (`river_job` and the rest) is applied with `rivermigrate` at startup. It is not part of the application's own migrations.

## Logs and metrics

The structured logs (slog) carry `event_id` / `event_type` / `idempotency_key` / `attempts`. The OpenTelemetry counters are:

- `publira.outbox.events.claimed`
- `publira.outbox.events.done`
- `publira.outbox.events.retry`
- `publira.outbox.events.dead`
- `publira.outbox.handler.duration` (histogram, seconds)

They are no-ops when there is no MeterProvider. The in-process counters are read by the tests.

## Processing flow

1. Claim due `pending` rows with `FOR UPDATE SKIP LOCKED` and enqueue the River jobs in the same transaction
2. The job runs the handler: `done` on success, or back to `pending` with exponential backoff on failure
3. `dead` on reaching the maximum attempt count or on a permanent error
4. After a process restart, unprocessed `pending` rows and stale `processing` rows are picked up again
