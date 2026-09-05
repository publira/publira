# Publira

English | [日本語](README.ja.md)

## Product vision

Publira is a multi-tenant SaaS that gives publishers with limited IT resources a digital distribution platform (manga and novels) they can run under their own brand. Publishers and editors submit the book information they receive from creators, and end users read it on the web or on mobile.

As an OSS project, it values portability, ease of operation, and freedom from vendor lock-in.

## Contributing

The repository layout, the toolchain, the verification commands, and the pull request conventions are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Tech stack

- Frontend: Next.js (App Router), React, TypeScript, Tailwind CSS
- Backend: Go 1.26, ConnectRPC (HTTP/2), sqlc
- Mobile: Flutter
- Database: PostgreSQL, golang-migrate
- Cache: Redis (shared store for the Next.js `cacheHandler` / `cacheHandlers`)
- Storage/Image: S3-compatible storage
- Infrastructure: Dev Containers, Docker, Make

## Setup

```bash
task setup
```

`task setup` installs dependencies (`pnpm`, Go, Flutter `pub get`) and initializes the database. In the Dev Container it runs automatically from `postCreate`, so the dependencies of `mobile/` are resolved without any extra step.

The Dev Container bundles the `migrate` CLI (golang-migrate) and `wait4x` (HTTP readiness waits for E2E and bootstrap). Add database changes to `db/migrations/` as `.up.sql` / `.down.sql` files.

## Dependency services

The repository-root `compose.yaml` defines every dependency service — PostgreSQL, Valkey (Redis protocol), RustFS (S3-compatible storage), Mailpit, and Jaeger — and publishes each of them on `127.0.0.1`.

```bash
docker compose up -d
```

The Dev Container starts the same file. `dockerComposeFile` in `.devcontainer/devcontainer.json` is `["../compose.yaml", "compose.yaml"]`, and the second file is an overlay that adds the `app` container and Traefik and resets the published ports, because everything inside the container reaches these services by service name.

| Service   | Host port        | Purpose                                |
| --------- | ---------------- | -------------------------------------- |
| `db`      | `5432`           | PostgreSQL                             |
| `redis`   | `6379`           | Valkey (Next.js shared cache)          |
| `rustfs`  | `9000` / `9001`  | S3 endpoint / console UI               |
| `mailpit` | `1025` / `8025`  | SMTP intake / web UI                   |
| `jaeger`  | `4318` / `16686` | OTLP intake (http/protobuf) / query UI |

Loopback only: none of these services authenticates a caller, so they are never published on every interface.

### Running `task setup` / `task dev` on the host

The defaults in `server/config`, `server/cmd/*`, and `db/Taskfile.yaml` name the Compose service (`db:5432`, `redis:6379`, `http://rustfs:9000`), which resolves only inside the Compose network. Outside the Dev Container, point them at loopback instead. `turbo.json` passes `PUBLIRA_*` through, so exported values reach `task dev` as is.

```bash
export PUBLIRA_DB_URL="postgres://postgres:password@127.0.0.1:5432/publira?sslmode=disable"
export PUBLIRA_PUBLIC_DB_URL="postgres://publira_public:publicpass@127.0.0.1:5432/publira?sslmode=disable"
export PUBLIRA_ADMIN_DB_URL="postgres://publira_admin:adminpass@127.0.0.1:5432/publira?sslmode=disable"
export PUBLIRA_PLATFORM_DB_URL="postgres://publira_platform:platformpass@127.0.0.1:5432/publira?sslmode=disable"
export PUBLIRA_REDIS_URL="redis://127.0.0.1:6379"
export PUBLIRA_S3_ENDPOINT="http://127.0.0.1:9000"
export PUBLIRA_S3_BUCKET="publira"
export PUBLIRA_S3_FORCE_PATH_STYLE="true"
export AWS_REGION="us-east-1"
export AWS_ACCESS_KEY_ID="publira"
export AWS_SECRET_ACCESS_KEY="publirapass"
export OTEL_EXPORTER_OTLP_ENDPOINT="http://127.0.0.1:4318"
export PUBLIRA_TRACING_ENABLED="true"
# Required, no fallback. See the two key sections below.
export PUBLIRA_AUTH_SECRET="$(openssl rand -base64 32)"
export PUBLIRA_AUTH_JWT_SECRET="$(openssl rand -base64 32)"
```

The role users and their development passwords come from `db/seeds/baseline`; `PUBLIRA_DB_URL` is the fallback for every server that has no role-specific URL. `e2e/bootstrap/scripts/lib.sh` exports the same set against its own ports and is a working reference.

Two things stay Dev Container only.

- **Traefik.** Its routers are Docker labels on the `app` container, so they cannot reach a process on the host. Open each app on its own port instead (`3000` / `4000` / `4100` for the three Next.js apps, `8000` for the API, `8200` for the image server).
- **The seeded SMTP host.** `db/seeds/dev` points the platform and tenant SMTP settings at `mailpit`. Change the host to `127.0.0.1` in the console when you want to send mail from a host process.

The per-worktree `dev-env` profiles described in [CONTRIBUTING.md](CONTRIBUTING.md#working-in-several-worktrees) are Dev Container only for the same reason: they address PostgreSQL and Valkey as `db` / `redis`.

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

A Mailpit container is part of the dependency stack (`compose.yaml`).

- Mailpit UI: `http://localhost:8025`
- SMTP: `host=mailpit`, `port=1025` from inside a container; `host=127.0.0.1`, `port=1025` from the host

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

- In the Dev Container the `redis` service starts and `PUBLIRA_REDIS_URL=redis://redis:6379` is passed to the app container; on the host it is `redis://127.0.0.1:6379` (loopback only, because no authentication is configured)
- To look inside directly: `docker compose exec redis redis-cli` from the repository root
- `redis://localhost:6379` is the library-side default that `@publira/next-cache-handlers` uses when `PUBLIRA_REDIS_URL` is unset
- The key space is separated per app by `PUBLIRA_CACHE_APP` (for example, `web-host`)
- Details: [packages/next-cache-handlers/README.md](packages/next-cache-handlers/README.md)

## Object storage for development (RustFS)

An S3-compatible **RustFS** container is part of the dependency stack (`compose.yaml`), so the apps take the same path as in production (episode image uploads and delivery by the image-server).

- Console UI: `http://localhost:9001/rustfs/console/`
- S3 endpoint: `http://rustfs:9000` from inside a container, `http://127.0.0.1:9000` from the host (path-style)
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

A **Jaeger** container is part of the dependency stack (`compose.yaml`), and the Go servers (`server/cmd/*`) and the Next.js apps (`apps/web-*`) send spans over OpenTelemetry. A browser request is connected into a single trace from the Next.js root span through the SSR Connect RPC, the Go-side RPC span, and the child spans of the DB queries, so you can follow "which layer spent the time" in the UI.

- Jaeger UI: `http://localhost:16686`
- OTLP intake: `http://jaeger:4318` from inside a container, `http://127.0.0.1:4318` from the host
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
