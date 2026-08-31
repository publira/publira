# platform-api-server

The ConnectRPC API server for platform administration.

## Running

From the repository root:

```bash
make dev-platform-api
```

From the `server` directory:

```bash
go run ./cmd/platform-api-server
```

Using a pre-built binary:

```bash
cd server && make build
./bin/platform-api-server
```

## Main environment variables

- `PUBLIRA_PLATFORM_API_ADDR` (optional, `:8002` when unset)
- `PUBLIRA_PLATFORM_DB_URL` (optional; a development default is used when unset)
- `PUBLIRA_AUTH_JWT_SECRET` (required, at least 32 bytes. The HS256 signing key for access tokens. The server fails to start when it is unset. For the details, see the [repository README](../../../README.md#api-access-token-signing-key-publira_auth_jwt_secret))
- `PUBLIRA_TRACING_ENABLED` (optional, disabled by default. Enables OpenTelemetry tracing)
- `PUBLIRA_DEPLOYMENT_ENVIRONMENT` (optional, `development` when unset. Determines `deployment.environment.name` and the default sampling rate)

The trace attributes, span naming, sampling, and the list of `OTEL_*` variables are in [server/README.md](../../README.md#distributed-tracing-opentelemetry).

## Role permissions

| Operation | `platform_auditor` | `platform_operator` | `platform_super_admin` |
| --- | --- | --- | --- |
| Viewing the dashboard, tenants, users, audit logs, settings, and notifications | Yes | Yes | Yes |
| Changing tenants, tenant members, tenant administrator invitations, end users, SMTP, and platform settings | No | Yes | Yes |
| Creating, changing the role of, suspending, activating, and deactivating platform operators | No | No | Yes |
| Marking one's own notifications as read, signing out, and changing one's password and email address | Yes | Yes | Yes |

The server checks mutating RPCs in a shared interceptor, so a rejected call never starts a DB update, an audit log entry, or an email.
