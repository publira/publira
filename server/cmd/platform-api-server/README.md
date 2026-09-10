# platform-api-server

The ConnectRPC API server for platform administration.

## Running

From the repository root:

```bash
task server:dev-platform-api
```

From the `server` directory:

```bash
go run ./cmd/platform-api-server
```

Using a pre-built binary:

```bash
task server:build
./server/bin/platform-api-server
```

## Main environment variables

- `PUBLIRA_PLATFORM_API_ADDR` (optional, `:8002` when unset)
- `PUBLIRA_PLATFORM_DB_URL` (optional; a development default is used when unset)
- `PUBLIRA_AUTH_JWT_SECRET` (required, at least 32 bytes. The HS256 signing key for access tokens. The server fails to start when it is unset. For the details, see the [repository README](../../../README.md#api-access-token-signing-key-publira_auth_jwt_secret))
- `PUBLIRA_REDIS_URL` (optional. Where the counters behind the mail limits below are kept. Unset / `disabled` / `off` / `false` limits each instance on its own, which is looser than a shared limit by the number of instances)
- `PUBLIRA_MAIL_REQUEST_LIMIT_PER_ADDRESS_PER_HOUR` (optional, `5` when unset. How much mail the forms that take an address may cause for one address in an hour, shared by all of them)
- `PUBLIRA_MAIL_REQUEST_LIMIT_PER_ADDRESS_PER_DAY` (optional, `20` when unset. The same allowance over a day)
- `PUBLIRA_MAIL_REQUEST_LIMIT_PER_SOURCE_PER_HOUR` (optional, `30` when unset. How much such mail one origin may cause in an hour, across every address)
- `PUBLIRA_MAIL_REQUEST_LIMIT_PER_SOURCE_PER_DAY` (optional, `150` when unset. The same allowance over a day)
- `PUBLIRA_TRACING_ENABLED` (optional, disabled by default. Enables OpenTelemetry tracing)
- `PUBLIRA_DEPLOYMENT_ENVIRONMENT` (optional, `development` when unset. Determines `deployment.environment.name` and the default sampling rate)

A mail limit below `1`, or one that is not a whole number, stops the server: a limit of zero refuses every form, and either is better caught at startup than by the first person who cannot get their password reset.

The trace attributes, span naming, sampling, and the list of `OTEL_*` variables are in [server/README.md](../../README.md#distributed-tracing-opentelemetry).

## Role permissions

| Operation | `platform_auditor` | `platform_operator` | `platform_super_admin` |
| --- | --- | --- | --- |
| Viewing the dashboard, tenants, users, audit logs, settings, and notifications | Yes | Yes | Yes |
| Changing tenants, tenant members, tenant administrator invitations, end users, SMTP, and platform settings | No | Yes | Yes |
| Creating, changing the role of, suspending, activating, and deactivating platform operators | No | No | Yes |
| Marking one's own notifications as read, signing out, and changing one's password and email address | Yes | Yes | Yes |

The server checks mutating RPCs in a shared interceptor, so a rejected call never starts a DB update, an audit log entry, or an email.
