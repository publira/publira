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
- `PUBLIRA_S3_BUCKET` (required)
- `AWS_REGION` (optional)
- `PUBLIRA_S3_ENDPOINT` (optional)
- `PUBLIRA_S3_FORCE_PATH_STYLE` (optional)
- `PUBLIRA_S3_PUBLIC_BASE_URL` (optional)
- `PUBLIRA_MFA_REQUIRED_FOR_TENANT_ADMIN` (optional, `false` when unset. With `true`, a tenant admin that has not enrolled a TOTP authenticator gets no session from a password alone; see [server/README.md](../../README.md#admin-mfa-totp))
- `PUBLIRA_COMMENT_WITHDRAWN_RETENTION_DAYS` (optional, `180` when unset. How long a comment its author withdrew is kept, which is the deadline `AdminCommentService.ListComments` reports as `purge_due_at`. `batch purge-withdrawn-comments` reads the same variable, so a value set for one has to be set for both, and anything below `1` or non-numeric stops the server rather than have the console count down to a deadline the batch refuses to enforce)
- `PUBLIRA_REDIS_URL` (optional. Where the counters behind the reader write limits, the step-up password limit, and the mail limits below are kept. Unset / `disabled` / `off` / `false` limits each instance on its own, which is looser than a shared limit by the number of instances)
- `PUBLIRA_COMMENT_POST_LIMIT_PER_MINUTE` (optional, `10` when unset. How many comments one reader may post in a minute)
- `PUBLIRA_COMMENT_POST_LIMIT_PER_DAY` (optional, `100` when unset. How many comments one reader may post in a day)
- `PUBLIRA_COMMENT_REPORT_LIMIT_PER_MINUTE` (optional, `10` when unset. How many comments one reader may report in a minute)
- `PUBLIRA_COMMENT_REPORT_LIMIT_PER_DAY` (optional, `50` when unset. How many comments one reader may report in a day)
- `PUBLIRA_COMMENT_DUPLICATE_WINDOW_MINUTES` (optional, `10` when unset. How long the same body by the same reader on the same episode is refused)
- `PUBLIRA_MAIL_REQUEST_LIMIT_PER_ADDRESS_PER_HOUR` (optional, `5` when unset. How much mail the forms that take an address may cause for one address in an hour, counted per tenant and shared by all of them)
- `PUBLIRA_MAIL_REQUEST_LIMIT_PER_ADDRESS_PER_DAY` (optional, `20` when unset. The same allowance over a day)
- `PUBLIRA_MAIL_REQUEST_LIMIT_PER_SOURCE_PER_HOUR` (optional, `30` when unset. How much such mail one origin may cause in an hour, across every address and tenant)
- `PUBLIRA_MAIL_REQUEST_LIMIT_PER_SOURCE_PER_DAY` (optional, `150` when unset. The same allowance over a day)
- `PUBLIRA_EPISODE_RATING_LIMIT_PER_MINUTE` (optional, `30` when unset. How many presses of the episode rating control one reader may make in a minute)
- `PUBLIRA_EPISODE_RATING_LIMIT_PER_DAY` (optional, `300` when unset. The same allowance over a day)
- `PUBLIRA_PASSWORD_VERIFY_LIMIT_PER_MINUTE` (optional, `5` when unset. How many times one account's password may be verified in a minute by the RPCs that ask for it on top of the session — `ChangePassword`, `DeleteMe`, `RequestEmailChange` — counted across all three and cleared by a verification that succeeds)
- `PUBLIRA_PASSWORD_VERIFY_LIMIT_PER_DAY` (optional, `50` when unset. The same allowance over a day)
- `PUBLIRA_REVALIDATE_TOKEN` (optional, the shared token sent in the `X-Revalidate-Token` header)
- `PUBLIRA_WEB_HOST_INTERNAL_URL` / `PUBLIRA_WEB_ADMIN_INTERNAL_URL` / `PUBLIRA_WEB_PLATFORM_INTERNAL_URL` (all required when `PUBLIRA_REVALIDATE_TOKEN` is set. The private network URL of each Next.js app)
- `PUBLIRA_TRACING_ENABLED` (optional, disabled by default. Enables OpenTelemetry tracing)
- `PUBLIRA_DEPLOYMENT_ENVIRONMENT` (optional, `development` when unset. Determines `deployment.environment.name` and the default sampling rate)

A reader write limit, a step-up password limit or a mail limit below `1`, or one that is not a whole number, stops the server at startup rather than taking effect: a limit of zero would refuse every reader, lock every account out of its own settings, and refuse every request for mail, and that is better caught before the server serves anything than by the first reader who runs into it.

The trace attributes, span naming, sampling, and the list of `OTEL_*` variables are in [server/README.md](../../README.md#distributed-tracing-opentelemetry).

Revalidation requests are sent to every Next.js app on a publication state update only when `PUBLIRA_REVALIDATE_TOKEN` and all three `PUBLIRA_WEB_*_INTERNAL_URL` variables are set. The fixed path at each destination is `/api/v1/revalidate`.

`PUBLIRA_WEB_HOST_URL` is the public URL that Stripe Checkout returns the browser to, and is separate from this set of internal URLs.

## Platform console role permissions

| Operation | `platform_auditor` | `platform_operator` | `platform_super_admin` |
| --- | --- | --- | --- |
| Viewing the dashboard, tenants, users, audit logs, settings, and notifications | Yes | Yes | Yes |
| Changing tenants, tenant members, tenant administrator invitations, end users, SMTP, and platform settings | No | Yes | Yes |
| Creating, changing the role of, suspending, activating, and deactivating platform operators | No | No | Yes |
| Marking one's own notifications as read, signing out, and changing one's password and email address | Yes | Yes | Yes |

The server checks mutating RPCs in a shared interceptor, so a rejected call never starts a DB update, an audit log entry, or an email.
