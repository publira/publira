# api-server

The ConnectRPC API server. It serves all three Connect namespaces — `publira.v1`, `publira.admin.v1`, and `publira.platform.v1` — from one process, over two listeners that differ in what is registered on each.

| Listener | Default address | Serves | Reached by |
| --- | --- | --- | --- |
| Edge-facing | `:8000` (`PUBLIRA_PUBLIC_API_ADDR`) | `publira.v1`, `/livez`, `/readyz` | The browser, through the reverse proxy's `/api` prefix |
| Internal | `:8100` (`PUBLIRA_PUBLIC_API_GRPC_ADDR`) | all three namespaces, `/livez`, `/readyz` | web-host, web-admin, and web-platform, over the private network, each through its own `PUBLIRA_GRPC_URL` |

A Connect handler answers gRPC, gRPC-Web, and the Connect protocol on one route, and the edge forwards `/api` host-agnostically, so neither the port nor the protocol separates the namespaces: registering a console service on the edge-facing mux would publish it at `/api/publira.admin.v1.…` on every tenant site. What each listener carries is decided in `main.go` and nowhere else.

Each namespace reaches the database through the pool opened for its own PostgreSQL login — `publira_public` and `publira_admin` under row-level security, `publira_platform` with `BYPASSRLS` — and each reports its spans under its own `service.name`, so the three stay apart in a trace UI.

## Running

From the repository root:

```bash
task server:dev-api
```

From the `server` directory:

```bash
go run ./cmd/api-server
```

Using a pre-built binary:

```bash
task server:build
./server/bin/api-server
```

## Main environment variables

- `PUBLIRA_PUBLIC_API_ADDR` (optional, `:8000` when unset. The edge-facing listener)
- `PUBLIRA_PUBLIC_API_GRPC_ADDR` (optional, `:8100` when unset. The internal listener)
- `PUBLIRA_PUBLIC_DB_URL` / `PUBLIRA_ADMIN_DB_URL` / `PUBLIRA_PLATFORM_DB_URL` (optional; a development default is used when unset. One per namespace; the process never falls back from one to another)
- `PUBLIRA_AUTH_JWT_SECRET` (required, at least 32 bytes. The HS256 signing key for access tokens. The server fails to start when it is unset. For the details, see the [repository README](../../../README.md#api-access-token-signing-key-publira_auth_jwt_secret))
- `PUBLIRA_SECRET_ENCRYPTION_KEYS` / `PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID` (optional. Encrypt and decrypt the stored SMTP, payment, object store, and FCM secrets)
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` (optional. The ambient credential for an object store saved without an access key. The store itself comes from the platform's settings; see [Image storage configuration](../../README.md#image-storage-configuration))
- `PUBLIRA_REDIS_URL` (optional. Where the counters behind the reader write limits, the step-up password limit, and the mail limits are kept. Unset / `disabled` / `off` / `false` limits each instance on its own, which is looser than a shared limit by the number of instances)
- `PUBLIRA_REVALIDATE_TOKEN` (optional, the shared token sent in the `X-Revalidate-Token` header)
- `PUBLIRA_WEB_HOST_INTERNAL_URL` / `PUBLIRA_WEB_ADMIN_INTERNAL_URL` / `PUBLIRA_WEB_PLATFORM_INTERNAL_URL` (all required when `PUBLIRA_REVALIDATE_TOKEN` is set. The private network URL of each Next.js app)
- `PUBLIRA_TRACING_ENABLED` (optional, disabled by default. Enables OpenTelemetry tracing)
- `PUBLIRA_DEPLOYMENT_ENVIRONMENT` (optional, `development` when unset. Determines `deployment.environment.name` and the default sampling rate)

The tenant-admin MFA requirement, the reader write limits, the step-up password limit, and the mail limits are not environment variables: they are the platform policy, read and saved through `PlatformPolicyService`, and a platform that has saved none gets the built-in defaults. A saved change reaches a running server within ten seconds.

The trace attributes, span naming, sampling, and the list of `OTEL_*` variables are in [server/README.md](../../README.md#distributed-tracing-opentelemetry).

A write that leaves a cache entry stale records a `next_cache_revalidation` outbox event, in its own transaction where it holds one, and then attempts the drop itself without making the response wait for it. Whatever that attempt does not finish, `worker` retries. Both halves need `PUBLIRA_REVALIDATE_TOKEN` and all three `PUBLIRA_WEB_*_INTERNAL_URL` variables; without them nothing is recorded and nothing is sent. The fixed path at each destination is `/api/v1/revalidate`.

`PUBLIRA_WEB_HOST_URL` is the public URL that Stripe Checkout returns the browser to, and is separate from this set of internal URLs.

## Platform console role permissions

| Operation | `platform_auditor` | `platform_operator` | `platform_super_admin` |
| --- | --- | --- | --- |
| Viewing the dashboard, tenants, users, audit logs, settings, and notifications | Yes | Yes | Yes |
| Changing tenants, tenant members, tenant administrator invitations, end users, SMTP, and platform settings | No | Yes | Yes |
| Creating, changing the role of, suspending, activating, and deactivating platform operators | No | No | Yes |
| Marking one's own notifications as read, signing out, and changing one's password and email address | Yes | Yes | Yes |

The server checks mutating RPCs in a shared interceptor, so a rejected call never starts a DB update, an audit log entry, or an email.
