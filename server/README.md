# server

The Go backend. It is operated as a single module, `github.com/publira/publira/server`.

## Directory layout

```text
server/
├── cmd/
│   ├── api-server/        # Public ConnectRPC API server
│   ├── admin-api-server/  # Admin ConnectRPC API server
│   ├── platform-api-server/ # Platform administration ConnectRPC API server
│   ├── image-server/      # Public image delivery (Manael conversion)
│   ├── admin-image-server/ # Admin image delivery
│   ├── batch/             # Single binary bundling every batch job (selected by subcommand)
│   └── outbox-worker/     # Long-lived Outbox + River worker
├── bin/                   # Binaries produced by task build
├── gen/                   # buf-generated code (do not edit)
└── internal/
    ├── db/                # sqlc-generated code (do not edit)
    └── testutil/          # Shared test helpers such as Testcontainers
```

## Responsibilities

- Serving the API for multi-tenant operation
- Business logic for content submission and publication
- Full rebuilds of the daily content statistics
- Purging view events past their retention window
- The scheduled publication batch (transition into the published state)
- Authentication and security foundations

## Implementation rules

1. Schema-first development: change `proto/` or the golang-migrate files under `db/migrations/` (`.up.sql` / `.down.sql`) first, then run `task gen`
2. Keep `cmd/` thin and put the implementation in `internal/`
3. Every batch lives in the single `cmd/batch` binary, and the subcommand in the first argument picks the job to run. `batch publish-episodes` is the tick processing for scheduled publication. The Outbox worker (`cmd/outbox-worker`) is a long-lived process separated from the APIs, where River executes the jobs

## Development commands

```bash
task db:setup
task db:seed
task db:create NAME=add_example_column
task server:dev-api
task server:dev-admin-api
task server:dev-platform-api
task server:dev-outbox-worker
task server:tidy
task server:build
task server:lint
task server:test
```

## Lint

- `task server:lint` (= `golangci-lint run ./...`) runs the static analysis. It is the same configuration and the same version as the `Lint / Go` job in CI.
- The rule set is [`.golangci.yml`](.golangci.yml). It enables golangci-lint's own `standard` default set (`errcheck` / `govet` / `ineffassign` / `staticcheck` / `unused`).
- `golangci-lint` is installed in the devcontainer at a pinned version (`GOLANGCI_LINT_VERSION` in [`.devcontainer/Dockerfile`](../.devcontainer/Dockerfile)). Install the same version when you run it outside the devcontainer.
- Generated code (`gen/**`, `internal/db/*.sql.go`, and so on) is excluded automatically by its `DO NOT EDIT.` header. The hand-written integration tests under `internal/db/` stay in scope.

## Tests

- Unit tests mostly mock the database with `sqlmock`.
- Integration tests against a real database start a PostgreSQL container with [Testcontainers for Go](https://golang.testcontainers.org/).
  - Shared helpers: `internal/testutil` (applying migrations, seeding the app roles, Snapshot/Restore, seeding tenants and the catalog)
  - Open a connection per app role with `OpenPlatformDB` / `OpenAdminDB` / `OpenPublicDB`. The latter two have RLS enabled, so they can verify the tenant boundary itself.
  - Examples: `TestDB*` in `api/platformapi` (tenant creation, uniqueness constraints, state transitions), `TestDB*` in `api/adminapi` (tenant isolation), `TestDB*` in `api/publicapi` (published/unpublished filtering, member authentication)
- Requirement: Docker must be usable locally (the affected tests skip when it is not running)
- For a faster run, `go test -short ./...` skips the integration tests that start containers

## Entrypoint details

- Public API server: [cmd/api-server/README.md](cmd/api-server/README.md)
- Admin API server: [cmd/admin-api-server/README.md](cmd/admin-api-server/README.md)
- Platform API server: [cmd/platform-api-server/README.md](cmd/platform-api-server/README.md)
- Public image server: [cmd/image-server/README.md](cmd/image-server/README.md)
- Admin image server: [cmd/admin-image-server/README.md](cmd/admin-image-server/README.md)
- Batch (scheduled publishing / daily content stats / ranking aggregation / content event purge / recommend feature build): [cmd/batch/README.md](cmd/batch/README.md)
- Outbox worker: [cmd/outbox-worker/README.md](cmd/outbox-worker/README.md)

## Graceful shutdown

The long-lived processes (`api-server` / `admin-api-server` / `platform-api-server` / `image-server` / `admin-image-server` / `outbox-worker`) call `http.Server.Shutdown` on SIGINT / SIGTERM. `outbox-worker` also stops the River client on the same deadline. Draining in-flight requests and the registered shutdown hooks share the same 30-second deadline. Connections that outlast the grace period are cut with `Close`. `admin-api-server` and `platform-api-server` flush the remaining asynchronous audit log entries within that same remaining time, after the HTTP drain and before closing the DB pool. Past the deadline, in-progress writes are cancelled and unsaved events are dropped, with the count and the cause recorded in metrics and structured logs. Each `main` passes closing the DB pool as its last hook, and also keeps a `defer db.Close()` as a safety net for the startup failure paths. Flushing OpenTelemetry spans joins this path once [#196](https://github.com/publira/publira/issues/196) adds the hook.

Give the orchestrator a SIGKILL grace period longer than 30 seconds (on Kubernetes, a `terminationGracePeriodSeconds` of 45 or more). Draining readiness at the load balancer is configured separately.

## Stripe Checkout (episode purchases)

Paid episodes are sold as a one-time payment through Stripe Checkout. The URL the browser returns to does not confirm the purchase. `POST /api/v1/webhook/stripe` on `web-host` receives the request on the tenant's public domain and does nothing but forward Stripe's raw body and signature to PurchaseService. The API server verifies the signature with the target tenant's enabled payment configuration and creates a row in `purchases` only when it receives `checkout.session.completed` (or `checkout.session.async_payment_succeeded` for asynchronous payments).

Starting Checkout and verifying the webhook both use the enabled configuration in `tenant_payment_config`. When the configuration is missing, disabled, or cannot be decrypted, no payment is started and the webhook records no purchase (web-host turns `FailedPrecondition` into a 503). After a completed or cancelled purchase the reader returns to the episode URL on the tenant's `domain`.

Tenant administrators register the Stripe secret key and the webhook signing secret through `AdminPaymentSettingsService`. Public reads return only the enabled state and a masked hint; the plaintext is limited to server-internal use through `paymentsettings.Store.LoadEnabledSecrets`. Verifying signatures, currencies, amounts, and purchase permissions stays in the API server.

In the Stripe Dashboard, register the tenant's public domain `https://<tenant-domain>/api/v1/webhook/stripe` as the webhook endpoint and enable the two events above. For local development, forward with the Stripe CLI:

```bash
stripe listen --forward-to localhost:3000/api/v1/webhook/stripe
```

Save the `whsec_...` it prints as that tenant's webhook signing secret through `UpdateTenantPaymentSettings`. For test cards, Stripe's `4242 4242 4242 4242` with any future date and a valid CVC works. A redelivered webhook does not create a duplicate purchase, thanks to the uniqueness constraint on `stripe_checkout_session_id`. An episode that already has a valid purchase does not start Checkout, and can be bought again once that purchase has expired.

## Image storage configuration

`UploadEpisodeImages` uploads to S3-compatible storage. If `PUBLIRA_S3_BUCKET` is unset, the server fails at startup.

- `PUBLIRA_S3_BUCKET` (required)
- `AWS_REGION` (recommended)
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` (as needed)
- `PUBLIRA_S3_ENDPOINT` (optional, for RustFS / MinIO and the like)
- `PUBLIRA_S3_FORCE_PATH_STYLE` (optional, `true`/`false`)
- `PUBLIRA_S3_PUBLIC_BASE_URL` (optional)

### Initializing the bucket

Creating the bucket is not the application's responsibility (it is never created from a regular request). In the development environment, the following task prepares it idempotently:

```bash
task storage:init
```

It creates `PUBLIRA_S3_BUCKET` with the aws CLI, and succeeds as-is when the bucket already exists. `task dev` runs it before starting each server, `task setup` runs it after `db:setup`, and the E2E and bootstrap preparation run it too. Production buckets are out of scope and are provisioned separately, together with their IAM and lifecycle settings.

### Development environment (RustFS)

The Dev Container starts the S3-compatible RustFS and connects to it path-style (endpoint `http://rustfs:9000`, bucket `publira`, with the local-only credentials `publira` / `publirapass`). For the full list of values and the console URL, see [../README.md](../README.md#object-storage-for-development-rustfs).

The Go integration tests against RustFS use the Testcontainers helper `StartRustFS` in `internal/testutil` to verify uploads in `internal/storage/s3` and fetches in `internal/imageserver` (skipped under `-short` or without Docker).

## Image delivery (Manael)

After checking permissions, `image-server` / `admin-image-server` convert JPEG/PNG/GIF to WebP or AVIF with [Manael](https://github.com/manaelproxy/manael) and resize them with `w` / `h` / `fit` / `q`. The converted result is kept in an intermediate cache, so the same `Accept` and query does not hit S3 or run the conversion again.

For episode body images unlocked by a purchase or a ticket, when `PUBLIRA_IMAGE_ENCRYPTION=enabled`, the cached converted plaintext is not returned as-is: it is encrypted just before the response, bound to a short-lived JWT and its `sub`. The default is disabled, so that enabling it explicitly after the decryption implementation from #357 is deployed keeps an early deploy from breaking existing viewers. An encrypted response has `Content-Type: application/octet-stream`, and the following headers are the decryption contract. Public images, and the admin previews that use `<img>`, remain ordinary image responses.

| Header | Value / meaning |
| --- | --- |
| `X-Publira-Image-Encryption` | `xor-hmac-sha256-v1` |
| `X-Publira-Image-Content-Type` | The MIME type after decryption (`image/webp` / `image/avif`, and so on) |
| `X-Publira-Image-Key-Id` | An opaque identifier for the converted rendition |

`xor-hmac-sha256-v1` takes the JWT string as the HMAC key, computes HMAC-SHA-256 over `"publira:image:xor-hmac-sha256:v1\\0" + sub + "\\0" + key-id`, and uses that output as the HMAC key. It then XORs the body with a 32-byte stream produced by HMAC-SHA-256 over the 8-byte big-endian block number. This is a delivery layer that raises the cost of extraction, not DRM. The client performs the same steps with the `t` in the URL (or the Bearer JWT it sent), the JWT's `sub`, and the headers above. The details of fetching, decrypting, and drawing to a Canvas are covered by #357.

- `PUBLIRA_REDIS_URL`: Redis for the conversion cache. Unset / `disabled` / `off` / `false` means in-process memory only
- `PUBLIRA_IMAGE_CACHE_TTL`: TTL of the conversion cache (a Go duration or a number of seconds; default `1h`)
- `PUBLIRA_IMAGE_ENCRYPTION`: with `enabled` / `true` / `on` / `1`, encrypts authorized episode bodies with `xor-hmac-sha256-v1` (disabled by default)

### Checking load and caching

Check `X-Publira-Image-Cache: miss|hit` in the response for the same image, the same `Accept`, and the same conversion parameters. Only the first `miss` reads from S3 and runs the Manael conversion; every later `hit` only encrypts the plaintext rendition from Redis (when configured) or the in-process cache. When verifying with encryption enabled, also measure that a different JWT produces different bytes for the body, that decrypting each response yields the same rendition, and that origin reads do not increase during the `hit`s.

Building requires libvips. For the details, see [cmd/image-server/README.md](cmd/image-server/README.md).

## Platform Console URL

- `PUBLIRA_PLATFORM_APP_URL`
  - The base URL of the Platform Console included in the platform-auth password reset email
  - Example: `https://platform.example.com`
  - When unset, `http://platform.localhost:3080` is used for local development

## Internal URLs for Next.js revalidation

With `PUBLIRA_REVALIDATE_TOKEN` set, admin-api and `batch publish-episodes` send cache tags to the internal Route Handler `POST /api/v1/revalidate` in each Next.js app. The tenant ID is part of neither the URL, the request body, nor the decision to send, and tags are revalidated as they are across tenants. All three URLs are required. If any of them is unset or malformed, revalidation is disabled and the process logs the reason and starts normally.

- `PUBLIRA_WEB_HOST_INTERNAL_URL` (for example `http://web-host:3000`)
- `PUBLIRA_WEB_ADMIN_INTERNAL_URL` (for example `http://web-admin:4000`)
- `PUBLIRA_WEB_PLATFORM_INTERNAL_URL` (for example `http://web-platform:4100`)

These are URLs reachable inside the private network. They do not go through the public URLs meant for browsers, `PUBLIRA_WEB_HOST_URL`, or Traefik. Each app keeps a separate Redis key space per `PUBLIRA_CACHE_APP`, so the same tag has to be sent to all three apps.

## Email renderer

- `PUBLIRA_EMAIL_RENDERER_URL`
  - The URL of the ConnectRPC service that outbox-worker uses to render tenant administrator invitation emails into HTML and plain text
  - Example: `http://email-renderer:8080` (container-to-container)
  - When unset, `http://localhost:8080` is used for local development

## Distributed tracing (OpenTelemetry)

Every process under `cmd/*` emits OpenTelemetry traces. **It is disabled by default**: unless `PUBLIRA_TRACING_ENABLED` is set, neither the TracerProvider nor the propagator is replaced, and the behavior is exactly what it was before the instrumentation was introduced (the processes start without any collection backend).

Attribute names, span naming, and the sampling policy follow the design agreed in [#502](https://github.com/publira/publira/issues/502).

### What gets a span

| Layer | Instrumentation | Span |
| --- | --- | --- |
| Inbound Connect / gRPC | `connectrpc.com/otelconnect` | One per RPC, named `AdminSeriesService/ListSeries` (the proto package is dropped from the name because the `rpc.service` attribute carries it) |
| Inbound plain HTTP (image-server / admin-image-server) | `otelhttp` | One per route pattern (`GET /images/creators/{media_id}`). `/livez` and `/readyz` are excluded |
| DB queries | `XSAM/otelsql` (wrapping the pgx driver in `internal/sqldb`) | One `db.query` per statement |
| The scheduled publication batch | `internal/publishepisodes` | One parent span per `RunOnce` cycle |
| The Outbox worker | `internal/outbox` | One per drain and one per processed event (`outbox.drain` / `outbox.process`) |
| Outbound HTTP (Next.js revalidation / email-renderer) | The `otelhttp` Transport | A client span and `traceparent` propagation |

Propagation uses W3C Trace Context (`traceparent`) and Baggage. An inbound `traceparent` is **trusted as the parent**, which is what connects the web app, the API, and the DB queries beyond it into a single trace. It can be trusted because the gateway strips inbound headers; the next section describes that boundary.

### Trace context arriving from outside

A server that trusts `traceparent` as its parent hands the trace ID and the `sampled` flag to whoever can set that header. So **the trust boundary lives at the gateway**, and `traceparent` / `tracestate` / `baggage` are removed from requests that came through a public entrypoint. The removal is applied as default middleware on the entrypoint, so adding another router cannot leave it out by accident.

| Environment | Where it is stripped |
| --- | --- |
| Development | Traefik in `.devcontainer/compose.yaml`. The `web` entrypoint gets the `strip-trace-context` middleware (empty values in `headers.customRequestHeaders`) by default |
| Production | The gateway's external entrypoint removes the same three headers before passing the request to the backend |

Because the headers are gone, the RPC becomes a **new root span** on the API side. The caller's trace ID is not adopted, and setting `sampled=01` does not override the 10% sampling in production. A trace is joined up only inside the gateway.

First-party server-to-server traffic does not pass through the gateway, so this removal does not apply to it. SSR (web-host / web-admin / web-platform) connects directly to the API's gRPC port, and the Go APIs call the Next.js revalidation endpoints directly through `PUBLIRA_WEB_*_INTERNAL_URL`. `traceparent` passes through in both cases, so "web app → API → DB query" remains a single trace.

The mobile app and the browser run on the user's device, so they are not first-party and their trace context is stripped at the gateway.

The stripping by Traefik in the development environment is verified by the connectivity checks in [`../e2e/routing/README.md`](../e2e/routing/README.md), which send requests that actually carry those headers.

### Operational monitoring for the asynchronous audit log

The asynchronous audit logs in `admin-api-server` and `platform-api-server` record the following low-cardinality OpenTelemetry metrics. `auditlog.entry_type` is `platform` or `tenant`, and `auditlog.drop_reason` is one of `queue_full`, `retry_exhausted`, and `shutdown`. Neither `action` nor the tenant ID is included as a metric attribute.

| Metric | Kind | Meaning |
| --- | --- | --- |
| `publira.auditlog.queue.depth` | gauge | Events queued and waiting to be persisted |
| `publira.auditlog.entries.enqueued` | counter | Events accepted into the queue |
| `publira.auditlog.entries.persisted` | counter | Events persisted asynchronously |
| `publira.auditlog.persist.failures` | counter | Failed persistence attempts (retries included) |
| `publira.auditlog.entries.dropped` | counter | Events dropped before being persisted |

Persistence retries, final drops, queue overflows, and shutdown drain deadlines are written to the structured log too. A continuously growing `queue.depth`, `persist.failures`, and `entries.dropped` are candidates for alerting. The meters are exported once an OTel MeterProvider is configured. Configuring a local Collector is the subject of [#198](https://github.com/publira/publira/issues/198).

### Resource attributes

| Key | Value |
| --- | --- |
| `service.name` | A default per process (`publira-api-server` / `publira-admin-api-server` / `publira-platform-api-server` / `publira-image-server` / `publira-admin-image-server` / `publira-outbox-worker`). `cmd/batch` resolves it per subcommand, so it becomes `publira-publish-episodes` / `publira-aggregate-content-stats` / `publira-aggregate-rankings` / `publira-purge-content-events` / `publira-purge-ranking-snapshots` / `publira-build-recommend-features`. Overridable with `OTEL_SERVICE_NAME` |
| `service.version` | The version embedded at build time; otherwise the VCS revision of the checkout, and otherwise `dev` (`internal/buildinfo`) |
| `deployment.environment.name` | `PUBLIRA_DEPLOYMENT_ENVIRONMENT`, or `development` when unset |

Container images are built from a context that does not include `.git`, so Go cannot embed the VCS information. Passing `VERSION`, as in `task docker:build:api VERSION=v1.2.3`, embeds it into `internal/buildinfo` through ldflags. Without it the value is `dev`.

### Span attributes

On top of the standard attributes that `otelconnect` / `otelhttp` / `otelsql` add (`rpc.system` / `rpc.service` / `rpc.method`, `http.request.method` / `http.route`, `db.system.name`), the following are set.

| Key | When |
| --- | --- |
| `tenant.public_id` | After the tenant is resolved (the tenant-scope interceptor in Connect, and host resolution in image-server) |
| `enduser.id` | After authentication succeeds. The value is the public ID |
| `db.operation.name` | The SQL keyword (`SELECT` / `INSERT` / …) |
| `db.query.summary` | The query name taken from sqlc's `-- name: GetTenantByID :one` |
| `db.query.text` | The generated SQL statement. sqlc emits it with placeholders (`$1`) intact, and argument values are never recorded |

Email addresses, raw tokens, passwords, request bodies, and the `Authorization` header are never put on a span. Using public IDs instead of internal UUIDs is part of the same policy.

### Sampling

Sampling is parent-based, and only the handling of root spans changes with the deployment environment.

| `PUBLIRA_DEPLOYMENT_ENVIRONMENT`            | Root span |
| ------------------------------------------- | --------- |
| `development` (default)                     | All       |
| Anything else (`staging` / `production`, …) | 10%       |

Setting `OTEL_TRACES_SAMPLER` bypasses these defaults and lets the SDK interpret the value. Heavy attributes such as `db.query.text` are only attached to sampled spans, so in production the full SQL text is only present on the sampled 10%.

### Correlation with logs

The slog handler in `internal/logging` adds `trace_id` / `span_id` to logs recorded with a `context.Context` that carries a span (the `*Context` methods such as `ErrorContext`). Each API's `internalDBError`, the shared path for DB errors, goes through it, so a `trace_id` from the logs can be searched directly in Jaeger or a similar tool.

### Environment variables

Only two variables are our own — the enable flag and the deployment environment. The rest are read by the OpenTelemetry SDK itself, so their names are unchanged.

| Variable | Purpose |
| --- | --- |
| `PUBLIRA_TRACING_ENABLED` | Enables tracing (`true` / `1`, and so on). Unset or uninterpretable values mean disabled |
| `PUBLIRA_DEPLOYMENT_ENVIRONMENT` | `development` (default) / `staging` / `production`. Determines `deployment.environment.name` and the default sampling rate |
| `OTEL_TRACES_EXPORTER` | `otlp` (default) / `console` / `none` |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf` / `grpc` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | The destination (for example `http://jaeger:4318`) |
| `OTEL_SERVICE_NAME` | Overrides `service.name` |
| `OTEL_RESOURCE_ATTRIBUTES` | Additional resource attributes |
| `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG` | The sampler. Setting it bypasses the defaults above |

To watch the behavior without a collection backend, `OTEL_TRACES_EXPORTER=console` prints spans to standard output.

```bash
PUBLIRA_TRACING_ENABLED=true OTEL_TRACES_EXPORTER=console task server:dev-admin-api
```

The Dev Container bundles Jaeger (its UI is at `http://localhost:16686`). For the details, see [../README.md](../README.md#distributed-tracing-jaeger).

## Secret encryption configuration (AES-GCM)

There is a foundation for encrypting secrets at rest with AES-GCM. For now, set the following environment variables when it is applied to a path that stores a secret field.

- `PUBLIRA_SECRET_ENCRYPTION_KEYS`
  - Format: `key-id-1:base64key,key-id-2:base64key`
  - `base64key` is a 16/24/32-byte AES key encoded in Base64 (standard or URL-safe)
- `PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID`
  - Names a key-id contained in `PUBLIRA_SECRET_ENCRYPTION_KEYS`
  - New encryptions use this key-id

Key rotation policy:

1. Add the new key to `PUBLIRA_SECRET_ENCRYPTION_KEYS`
2. Switch `PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID` to the new key ID
3. Re-store and re-encrypt the existing data to gradually replace the ciphertext produced with the old key
4. Remove the old key only after confirming that no data is decrypted with it any more

Notes:

- Never log a key or a plaintext
- On an encryption or decryption failure, do not continue — treat it as a failure

## Authentication (JWT access tokens)

The API issues **HS256 JWT access tokens** from an email address and a password (`Login` / `Logout`).  
Browser cookies are managed on the Next.js side as JWE with `jose`, and only `Authorization: Bearer <token>` is sent to the API.

| Item | Value |
| --- | --- |
| Environment variable | `PUBLIRA_AUTH_JWT_SECRET` (**required**, at least 32 bytes. There is no fallback: if it is unset or too short, the API servers and the image servers fail to start) |
| TTL | 24h |
| Audience | `public` / `admin` / `platform` / `media` / `admin-media` |
| Revocation | `users.credentials_version` / `platform_users.credentials_version` (incremented on a password change and the like) |
| Next cookie | `PUBLIRA_AUTH_SECRET` (**required**, at least 32 bytes. It is for JWE and is separate from the API's JWT secret. There is no fallback: if it is unset or too short, an exception is raised) / cookie names such as `publira_web_host_auth` |

### Media tokens (audience `media`)

A browser cannot attach an `Authorization` header to an `<img>` request. So for a reader who may view a paid episode, `GetEpisodeDetail` returns the body image URLs with a `t=<JWT>` query appended.

| Item | Value |
| --- | --- |
| Audience | `media` (separate from `public`; it does not pass to the API, and pasting an access token into the URL does not open the image) |
| TTL | 15 minutes |
| Scope | Only the single episode it was issued for (claim `eid`) |
| Revocation | The same `users.credentials_version` as the access token |

The token only states who the reader is; whether the image may be viewed is decided by `image-server`, which consults purchases and access_tickets on every request (the same rules as the API). URLs for free episodes (`price = 0`) carry no token.

### Admin media tokens (audience `admin-media`)

Episode image previews in the admin UI also go through the browser's `<img>` / `next/image`, so they carry no `Authorization` either. `ListEpisodeImages` / `UploadEpisodeImages` / `ReorderEpisodeImages` return the body image URLs with a `t=<JWT>` query appended.

| Item | Value |
| --- | --- |
| Audience | `admin-media` (separate from both `media` and `admin`; it does not pass to the public image-server or to the admin API) |
| TTL | 15 minutes |
| Scope | Only the single episode it was issued for (claim `eid`) |
| Revocation | The same `users.credentials_version` as the access token |

The token only states who the administrator is; `admin-image-server` consults the tenant membership and the admin role (`tenant_admin` / `tenant_editor` / `tenant_auditor`) on every request. It does not look at the publication state or the price.

## View events (soft PV) and anonymous actors

`ContentViewService.RecordContentView` records a view event in `content_events` for the series or episode detail page a reader opened. This is the Phase 1 soft PV, and it means nothing more than "the reader opened the page" (hard PV, which observes whether the body was actually read, comes later). The target is resolved before anything is written, so an unpublished, cross-tenant, or missing public ID is `not_found`; once it resolves, the recording is decoupled from the main processing and the RPC succeeds even when the write fails.

The detail RPCs deliberately record nothing. Their callers cache them (`"use cache"` in web-host), and a cache fill reaches the API without the reader's cookie or bearer: instrumenting them would mint a fresh anonymous actor per fill and add a row for a page nobody opened, while a cache hit would record no reader at all. Recording lives in its own RPC so the reader's request is the only thing that files a view.

| Item | Value |
| --- | --- |
| Event type | `episode_view` (episode target) / `series_view` (series target) |
| actor | `user_id` while signed in, otherwise the `anonymous_id` from the `publira_aid` cookie (`content_events.actor_key` unifies them with `COALESCE`) |
| Debounce | Fixed 30-minute epoch buckets (`floor(unix / 1800)`) plus `ON CONFLICT DO NOTHING` against a partial UNIQUE index. It is not a sliding window |
| `series_id` | Resolved from `episodes` rather than taken from client input |
| Authentication | Optional. A rejected or unverifiable bearer does not fail the call; the view falls back to the `publira_aid` cookie, and is recorded only if the request carried one. No identifier is minted for a caller that presented a session |
| Prefetch | Nothing is recorded when `Sec-Purpose` / `Purpose` / `X-Purpose` / `X-Moz` / `Next-Router-Prefetch` indicate a speculative request |
| Payload | `{"pv_kind":"soft"}` only. No personal data such as an IP address, a User-Agent, or an email address is stored |

### The `publira_aid` cookie

A cookie whose only purpose is counting signed-out readers. Its value is a UUIDv7 assigned by the server and contains nothing else. When the cookie is absent, or its value does not parse as a UUID, a new one is assigned and returned in the response's `Set-Cookie`.

| Attribute | Value |
| --- | --- |
| Name | `publira_aid` |
| Path | `/` |
| Max-Age | 180 days (longer than the retention period for raw events, and short enough that an abandoned identifier does not live on forever) |
| Others | `HttpOnly` / `Secure` / `SameSite=Lax` |

## Rating events

`RatingService.RateContent` records a 1–5 rating from a signed-in reader in `content_events`. Unlike a view event, it is an explicit action by the reader, so a failure is returned as an error rather than swallowed.

| Item | Value |
| --- | --- |
| Event type | `rating` |
| actor | `user_id` (sign-in required; anonymous ratings are not accepted) |
| Target | `series_id` alone for a series rating, `series_id` + `episode_id` for an episode rating |
| `series_id` | Resolved from `series` / `episodes` rather than taken from client input |
| Score | `rating_score` 1–5. Out-of-range values and an unset 0 are `invalid_argument` (there is a CHECK constraint on the DB side too) |
| Append-only | Rating again neither updates nor deletes the existing row; it appends a new one |

There is no RPC for withdrawing a rating. Which rating counts is decided on read rather than on write: `ListLatestContentRatingsByEntity` (`DISTINCT ON (actor_key)`) returns the latest single row per actor.

The daily aggregation (`rating_count` / `rating_sum` in `content_daily_stats`) is a **flow metric** that counts only the ratings that occurred on that day, not the average rating (a stock) the item holds at that point. A reader who rates again is counted on both days, and a reader who does not change their rating is counted on no day after the first. Use the `DISTINCT ON` above when you need the stock average.

## API server separation

- Public API server: `server/cmd/api-server`
  - Public services: `CatalogService`, `AuthService`
  - Default port: `:8000`
- Admin API server: `server/cmd/admin-api-server`
  - Admin services: `AdminSeriesService`, `AdminAuthService`
  - Default port: `:8001` (changeable with `PUBLIRA_ADMIN_API_ADDR`)
  - Next.js revalidation on a publication state change: set `PUBLIRA_REVALIDATE_TOKEN`
  - The destinations are the internal URLs of every `web-*` app (`PUBLIRA_WEB_*_INTERNAL_URL`)

This makes it possible to operate the public and the admin side as separate processes on separate paths.

## Database users

Each API server connects with its own dedicated PostgreSQL login user, which keeps privileges minimal.

| Server | DB user | Environment variable | Local default |
| --- | --- | --- | --- |
| platform-api | `publira_platform` | `PUBLIRA_PLATFORM_DB_URL` | `postgres://publira_platform:platformpass@db:5432/publira?sslmode=disable` |
| admin-api | `publira_admin` | `PUBLIRA_ADMIN_DB_URL` | `postgres://publira_admin:adminpass@db:5432/publira?sslmode=disable` |
| api (public) | `publira_public` | `PUBLIRA_PUBLIC_DB_URL` | `postgres://publira_public:publicpass@db:5432/publira?sslmode=disable` |
| outbox-worker | Equivalent to BYPASSRLS (superuser locally) | `PUBLIRA_WORKER_DB_URL` (falling back to `PUBLIRA_DB_URL`) | `postgres://postgres:password@db:5432/publira?sslmode=disable` |
| batch aggregate-content-stats | `publira_content_stats` (BYPASSRLS) | `PUBLIRA_CONTENT_STATS_DB_URL`, falling back to `PUBLIRA_WORKER_DB_URL` → `PUBLIRA_DB_URL` | `postgres://publira_content_stats:contentstatspass@db:5432/publira?sslmode=disable` |
| batch aggregate-rankings | `publira_content_stats` (BYPASSRLS) | `PUBLIRA_CONTENT_RANKING_DB_URL`, falling back to `PUBLIRA_CONTENT_STATS_DB_URL` → `PUBLIRA_WORKER_DB_URL` → `PUBLIRA_DB_URL` | `postgres://publira_content_stats:contentstatspass@db:5432/publira?sslmode=disable` |
| batch purge-content-events | `publira_content_stats` (BYPASSRLS) | `PUBLIRA_CONTENT_EVENTS_DB_URL`, falling back to `PUBLIRA_CONTENT_STATS_DB_URL` → `PUBLIRA_WORKER_DB_URL` → `PUBLIRA_DB_URL` | `postgres://publira_content_stats:contentstatspass@db:5432/publira?sslmode=disable` |
| batch purge-ranking-snapshots | `publira_content_stats` (BYPASSRLS) | `PUBLIRA_CONTENT_RANKING_DB_URL`, falling back to `PUBLIRA_CONTENT_STATS_DB_URL` → `PUBLIRA_WORKER_DB_URL` → `PUBLIRA_DB_URL` | `postgres://publira_content_stats:contentstatspass@db:5432/publira?sslmode=disable` |
| batch build-recommend-features | `publira_content_stats` (BYPASSRLS) | `PUBLIRA_RECOMMEND_FEATURES_DB_URL`, falling back to `PUBLIRA_CONTENT_STATS_DB_URL` → `PUBLIRA_WORKER_DB_URL` → `PUBLIRA_DB_URL` | `postgres://publira_content_stats:contentstatspass@db:5432/publira?sslmode=disable` |

`publira_platform` and `publira_content_stats` carry the BYPASSRLS attribute and access data across every tenant. `publira_admin` / `publira_public` have RLS enabled and are scoped by tenant ID.

### Local development

`task db:setup` applies `db/seeds/baseline/000_rls_bypass_role.sql`, which creates the four users.

### Production

After running the seed, change each user's password to a secure value:

```sql
ALTER ROLE publira_platform PASSWORD '<secure_password>';
ALTER ROLE publira_content_stats PASSWORD '<secure_password>';
ALTER ROLE publira_admin    PASSWORD '<secure_password>';
ALTER ROLE publira_public   PASSWORD '<secure_password>';
```

Then set each server's environment variable (`PUBLIRA_PLATFORM_DB_URL`, `PUBLIRA_CONTENT_STATS_DB_URL`, `PUBLIRA_ADMIN_DB_URL`, `PUBLIRA_PUBLIC_DB_URL`) to a URL containing the matching password.

## Notes on initial data

- Using AuthService requires at least some data in `tenants` and `users`.
- Use a `bcrypt` hash for `users.password_hash`.
- Health checks (shared by the API, image-server, and the web apps):
  - `GET /livez` — process liveness. Always `200` with a plain `ok`. Intended for a K8s livenessProbe.
  - `GET /readyz` — readiness of the dependencies. `200` when healthy, `503` when not. Intended for a K8s readinessProbe or a load balancer.
  - API / image-server: at minimum a DB `Ping`
  - Web (`web-admin` / `web-host` / `web-platform`): the upstream API's `/readyz` plus Redis (the Redis check is skipped when `PUBLIRA_REDIS_URL` is disabled)
  - Example `/readyz` responses (JSON):
    - Healthy: `{"status":"ok","checks":{"db":{"status":"ok"}}}`
    - Dependency failure: `{"status":"unavailable","checks":{"db":{"status":"error","error":"..."}}}` (HTTP 503)
    - Startup gate not yet open: `{"status":"starting","checks":{...}}` (HTTP 503)
