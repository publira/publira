# Publira

English | [日本語](README.ja.md)

## Product vision

Publira is a multi-tenant SaaS that gives publishers with limited IT resources a digital distribution platform (manga and novels) they can run under their own brand. Publishers and editors submit the book information they receive from creators, and end users read it on the web or on mobile.

As an OSS project, it values portability, ease of operation, and freedom from vendor lock-in.

## Directory structure

```text
.
├── apps/               # [Node.js] Web apps (Turborepo)
│   ├── web-host/       # Tenant-facing site (catalog / auth / my page)
│   ├── web-admin/      # Submission and management console for publishers and editors
│   ├── web-platform/   # Cross-tenant operations console for platform operators
│   └── email-renderer/ # Node service that renders React Email over ConnectRPC
├── packages/           # [Node.js] Shared UI and utilities
├── e2e/                # [Playwright] Cross-app E2E foundation
├── server/             # [Go] Backend system (single module)
│   ├── cmd/
│   │   ├── api-server/       # ConnectRPC API server
│   │   ├── batch/            # Single binary bundling every batch job (selected by subcommand)
│   │   └── outbox-worker/    # Outbox + River resident worker
│   ├── gen/            # buf generated code (Go)
│   └── internal/
│       └── db/         # sqlc generated code (DB/Go)
├── infra/
│   └── docker/         # Production Dockerfiles (per role, built from the repository root)
├── mobile/             # [Flutter] Mobile app (iOS/Android)
├── proto/              # Protocol Buffers schema definitions
├── locales/            # Shared UI messages (JSON, read by Go / Web / Flutter alike)
└── db/                 # PostgreSQL migrations and queries
```

## Tech stack

- Frontend: Next.js (App Router), React, TypeScript, Tailwind CSS
- Backend: Go 1.26, ConnectRPC (HTTP/2), sqlc
- Mobile: Flutter
- Database: PostgreSQL, golang-migrate
- Cache: Redis (shared store for the Next.js `cacheHandler` / `cacheHandlers`)
- Storage/Image: S3-compatible storage
- Infrastructure: Dev Containers, Docker, Make

## Documentation map

- Conventions for agents (Effects, lint, and so on): [AGENTS.md](AGENTS.md)
- Web apps: [apps/README.md](apps/README.md)
- Shared packages: [packages/README.md](packages/README.md)
- Go backend: [server/README.md](server/README.md)
- Mobile: [mobile/README.md](mobile/README.md)
- CI workflows as a whole (job layout, path filters, triage): [.github/workflows/README.md](.github/workflows/README.md)
- Dockerfile layout conventions and build verification (production images): [infra/docker/README.md](infra/docker/README.md)
- E2E (Playwright foundation, CI): [e2e/README.md](e2e/README.md)
- Development environment bootstrap check (`task setup` / `task dev` from an empty DB volume): [e2e/bootstrap/README.md](e2e/bootstrap/README.md)
- Traefik routing connectivity in the development environment (host, `/api`, `/images`): [e2e/routing/README.md](e2e/routing/README.md)

## Setup

```bash
task setup
```

`task setup` installs dependencies (`pnpm`, Go, Flutter `pub get`) and initializes the database. In the Dev Container it runs automatically from `postCreate`, so the dependencies of `mobile/` are resolved without any extra step.

The Dev Container bundles the `migrate` CLI (golang-migrate) and `wait4x` (HTTP readiness waits for E2E and bootstrap). Add database changes to `db/migrations/` as `.up.sql` / `.down.sql` files.

## Per-worktree development environment profile

When you work in several worktrees in parallel, pick a profile per worktree instead of sharing the default development environment. A profile separates the PostgreSQL database, the Valkey logical database, the RustFS bucket, the ports of every service, the cookie names, and the authentication and revalidation secrets. The plain `task setup` / `task dev` keep using the shared environment as before.

```bash
# Once per new worktree (the identifier takes lowercase alphanumerics and -)
task dev-env:create NAME=issue-1178

# Database migration/seed and creation of the dedicated bucket. Safe to re-run.
task dev-env:init

# Start the API, image server, worker, email-renderer, and the three Next.js apps together
task dev-env:start

# Show the URLs, the logs, and the assigned DB/Redis/bucket
task dev-env:show

# When you are done. Data is kept.
task dev-env:stop
```

Load the same environment variables first when starting a single app as well. `pnpm dev` in each Next.js app honors `PORT`, so you do not have to resolve default port collisions by hand.

```bash
eval "$(task --silent dev-env:env)"
pnpm --dir apps/web-host dev
```

`task dev-env:list` shows every profile and the worktree that selected it. To discard one, run `task dev-env:destroy NAME=<name>`. It checks that no worktree has the target selected and that it is stopped, then deletes only that profile's database, Redis DB, and bucket after you retype the name. It does not touch the shared development environment, E2E, or other profiles.

A profile's secrets and run logs are stored under `~/.publira/dev-env` by default. Override the location with `PUBLIRA_DEV_ENV_HOME` and the PostgreSQL admin connection with `PUBLIRA_DEV_ENV_POSTGRES_ADMIN_URL` only when you need to. Both are read solely by the development environment scripts.

Coding agents use [`skills/dev-env-profile`](skills/dev-env-profile/SKILL.md) when they start development.

## Local database initialization

```bash
task db:setup
```

`db:setup` runs the following in order.

1. Apply migrations (`db/migrations/`)
2. Apply the baseline seed (`db/seeds/baseline/`)

### Responsibilities of migrations and seeds

- Migration: schema changes (DDL)
- Seed: initial data for local development and screen checks (DML, idempotent)

See `db/seeds/README.md` for the details of the seed and the fixed login credentials.

## Checking mail in development (Mailpit)

A Mailpit container starts together with the Dev Container.

- Mailpit UI: `http://localhost:8025`
- SMTP (from inside a container): `host=mailpit`, `port=1025`

In the local seed (`task db:setup`), the initial platform/tenant SMTP settings point at Mailpit.

1. Run `task db:setup` to load the initial data
2. Start `task dev` (or the individual API/Web tasks)
3. Send an SMTP test message or a notification
4. Check the received mail in the Mailpit UI (`http://localhost:8025`)

## Session cookie encryption key (`PUBLIRA_AUTH_SECRET`)

The three Next.js apps (web-host / web-admin / web-platform) seal the login session with the JWE (`dir` + `A256GCM`) of `@publira/web-session`. `PUBLIRA_AUTH_SECRET` is that key.

- It is **required**. There is no fallback in the code, and encryption and decryption throw when it is unset or shorter than 32 bytes (`resolveAuthSecret()`)
- The cookie payload carries the API access token, so leaking the key allows both forging and decrypting a session. Issue one per environment (for example, `openssl rand -base64 32`)
- In the Dev Container, `.devcontainer/compose.yaml` passes a development-only value to the app container. `dev` in `turbo.json` sets `passThroughEnv: ["PUBLIRA_*"]`, so it reaches `task dev` as is
- E2E exports its own value for its stack from `e2e/scripts/lib.sh`, and the bootstrap check from `e2e/bootstrap/scripts/lib.sh`

The values written in this repository are **for local development and testing only**. Do not carry them into production.

## API access token signing key (`PUBLIRA_AUTH_JWT_SECRET`)

The Go API servers (api-server / admin-api-server / platform-api-server) and the image servers (image-server / admin-image-server) issue an **HS256 JWT access token** at login and verify it on subsequent requests. `PUBLIRA_AUTH_JWT_SECRET` is that signing key.

- It is **required**. There is no fallback in the code, and all five servers exit at startup when it is unset or shorter than 32 bytes (`auth.NewTokenManagerFromEnv()`)
- Leaking the key allows forging a token with an arbitrary `sub` / `aud` and calling the public API, the admin API, the platform API, and the image servers. Issue one per environment (for example, `openssl rand -base64 32`)
- It is a different key from the cookie-side `PUBLIRA_AUTH_SECRET`, which is the JWE key Next.js uses to seal the session cookie: different readers, different purpose
- In the Dev Container, `.devcontainer/compose.yaml` passes a development-only value to the app container
- For E2E, `e2e/scripts/lib.sh` exports it and each API server's start script passes it through `env`. The bootstrap check exports it from `e2e/bootstrap/scripts/lib.sh`

The values written in this repository are **for local development and testing only**. Do not carry them into production.

## Next.js shared cache (Redis)

For self-hosted and multi-instance deployments, the server-side cache of Next.js is shared through **Redis** (`@publira/next-cache-handlers`).

| Setting | Purpose |
| --- | --- |
| `cacheHandlers` (plural) | `"use cache"` / `"use cache: remote"` |
| `cacheHandler` (singular) | ISR, Route Handlers, `fetch`, and the `next/image` optimization results (`images.customCacheHandler: true`) |

- In the Dev Container the `redis` service starts and `PUBLIRA_REDIS_URL=redis://redis:6379` is passed to the app container (it is not exposed to the host because no authentication is configured)
- To look inside directly: `docker compose -f .devcontainer/compose.yaml exec redis redis-cli`
- `redis://localhost:6379` is the library-side default that `@publira/next-cache-handlers` uses when `PUBLIRA_REDIS_URL` is unset
- The key space is separated per app by `PUBLIRA_CACHE_APP` (for example, `web-host`)
- Details: [packages/next-cache-handlers/README.md](packages/next-cache-handlers/README.md)

## Object storage for development (RustFS)

An S3-compatible **RustFS** container also starts with the Dev Container, so the apps take the same path as in production (episode image uploads and delivery by the image-server).

- Console UI: `http://localhost:9001/rustfs/console/`
- S3 endpoint (from inside a container): `http://rustfs:9000` (path-style; not exposed to the host)
- Bucket: `publira`. `task setup` / `task dev` create it idempotently through `task storage:init`
- Data is persisted in the `rustfs-data` volume

The defaults passed to the app container live in `.devcontainer/compose.yaml`.

| Variable                                      | Default                   |
| --------------------------------------------- | ------------------------- |
| `PUBLIRA_S3_BUCKET`                           | `publira`                 |
| `PUBLIRA_S3_ENDPOINT`                         | `http://rustfs:9000`      |
| `PUBLIRA_S3_FORCE_PATH_STYLE`                 | `true`                    |
| `AWS_REGION`                                  | `us-east-1`               |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | `publira` / `publirapass` |

These access keys are **for local development only** (they work against nothing but the RustFS container). Production S3 uses IAM roles or separately issued credentials; do not carry these values there. Creating the bucket uses the aws CLI, so the Dev Container bundles the `aws-cli` feature.

See [server/README.md](server/README.md) for the list of server-side environment variables.

## Distributed tracing (Jaeger)

A **Jaeger** container also starts with the Dev Container, and the Go servers (`server/cmd/*`) and the Next.js apps (`apps/web-*`) send spans over OpenTelemetry. A browser request is connected into a single trace from the Next.js root span through the SSR Connect RPC, the Go-side RPC span, and the child spans of the DB queries, so you can follow "which layer spent the time" in the UI.

- Jaeger UI: `http://localhost:16686`
- OTLP intake (from inside a container): `http://jaeger:4318` (not exposed to the host)
- Storage is in-memory, so past traces disappear when the container restarts

The defaults passed to the app container live in `.devcontainer/compose.yaml`.

| Variable                      | Default              |
| ----------------------------- | -------------------- |
| `PUBLIRA_TRACING_ENABLED`     | `true`               |
| `OTEL_TRACES_EXPORTER`        | `otlp`               |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf`      |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://jaeger:4318` |

Everything except `PUBLIRA_TRACING_ENABLED` is read by the OpenTelemetry SDK itself, so the names follow the OpenTelemetry documentation. Tracing is disabled by default, and this dev stack enables it explicitly. `PUBLIRA_DEPLOYMENT_ENVIRONMENT` is left unset, so the environment counts as `development` and every root span is sampled.

Traefik drops `traceparent` / `tracestate` / `baggage` from the requests that arrive at the `web` entry point (`localhost:3080`). Both the Go servers and the Next.js apps trust an inbound `traceparent` as the parent, so the trust boundary is placed at the gateway. Attaching your own `traceparent` to a `curl` against `3080` does not produce that trace ID; a new root span begins at the receiving end.

### How to read it

1. Start the stack with an active dev profile (`task dev-env:start`; it prints the URLs of the profile)
2. Open the printed host URL in a browser
3. In the Jaeger UI (`http://localhost:16686`), select `publira-web-host` under Service and open a recent trace

Under the root span of `GET /[tenant_id]/[locale]` you find the client spans SSR called, such as `CatalogService/ListPublishedSeries`, the identically named server spans of `publira-api-server` as their children, and `db.query` below those. When the service changes within one trace, propagation from Web to API to DB is working. The processing of `proxy.ts` forms a separate trace rooted at `middleware GET`.

Start with `NEXT_OTEL_VERBOSE=1` only when you want to see the internal spans of Next.js itself (`BaseServer.renderToResponse`, `Router.executeRoute`, and so on). It is off by default because the number of spans per request grows a lot and the trace fills up at a stage the application code cannot influence.

```bash
NEXT_OTEL_VERBOSE=1 pnpm --dir apps/web-host dev
```

Attributes, span naming, and the sampling policy follow the design agreed in [#502](https://github.com/publira/publira/issues/502). For the details of the configuration and instrumentation, see [server/README.md](server/README.md#distributed-tracing-opentelemetry) for the Go side and [packages/tracing/README.md](packages/tracing/README.md) for the Next.js side.
