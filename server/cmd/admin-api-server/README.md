# admin-api-server

The admin ConnectRPC API server.

## Running

From the repository root:

```bash
task server:dev-admin-api
```

From the `server` directory:

```bash
go run ./cmd/admin-api-server
```

Using a pre-built binary:

```bash
task server:build
./server/bin/admin-api-server
```

## Main environment variables

- `PUBLIRA_ADMIN_API_ADDR` (optional, `:8001` when unset)
- `PUBLIRA_ADMIN_DB_URL` (optional; a development default is used when unset)
- `PUBLIRA_AUTH_JWT_SECRET` (required, at least 32 bytes. The HS256 signing key for access tokens. The server fails to start when it is unset. For the details, see the [repository README](../../../README.md#api-access-token-signing-key-publira_auth_jwt_secret))
- `PUBLIRA_S3_BUCKET` (required)
- `AWS_REGION` (optional)
- `PUBLIRA_S3_ENDPOINT` (optional)
- `PUBLIRA_S3_FORCE_PATH_STYLE` (optional)
- `PUBLIRA_S3_PUBLIC_BASE_URL` (optional)
- `PUBLIRA_MFA_REQUIRED_FOR_TENANT_ADMIN` (optional, `false` when unset. With `true`, a tenant admin that has not enrolled a TOTP authenticator gets no session from a password alone; see [server/README.md](../../README.md#admin-mfa-totp))
- `PUBLIRA_COMMENT_WITHDRAWN_RETENTION_DAYS` (optional, `180` when unset. How long a comment its author withdrew is kept, which is the deadline `AdminCommentService.ListComments` reports as `purge_due_at`. The purge batch reads the same variable, so a value set for one has to be set for both, and anything below `1` or non-numeric stops the server rather than have the console count down to a deadline the batch refuses to enforce)
- `PUBLIRA_REDIS_URL` (optional. Where the counters behind the mail limits below are kept. Unset / `disabled` / `off` / `false` limits each instance on its own, which is looser than a shared limit by the number of instances)
- `PUBLIRA_MAIL_REQUEST_LIMIT_PER_ADDRESS_PER_HOUR` (optional, `5` when unset. How much mail the forms that take an address may cause for one address in an hour, shared by all of them)
- `PUBLIRA_MAIL_REQUEST_LIMIT_PER_ADDRESS_PER_DAY` (optional, `20` when unset. The same allowance over a day)
- `PUBLIRA_MAIL_REQUEST_LIMIT_PER_SOURCE_PER_HOUR` (optional, `30` when unset. How much such mail one origin may cause in an hour, across every address)
- `PUBLIRA_MAIL_REQUEST_LIMIT_PER_SOURCE_PER_DAY` (optional, `150` when unset. The same allowance over a day)
- `PUBLIRA_REVALIDATE_TOKEN` (optional, the shared token sent in the `X-Revalidate-Token` header)
- `PUBLIRA_WEB_HOST_INTERNAL_URL` / `PUBLIRA_WEB_ADMIN_INTERNAL_URL` / `PUBLIRA_WEB_PLATFORM_INTERNAL_URL` (all required when `PUBLIRA_REVALIDATE_TOKEN` is set. The private network URL of each Next.js app)
- `PUBLIRA_TRACING_ENABLED` (optional, disabled by default. Enables OpenTelemetry tracing)
- `PUBLIRA_DEPLOYMENT_ENVIRONMENT` (optional, `development` when unset. Determines `deployment.environment.name` and the default sampling rate)

A mail limit below `1`, or one that is not a whole number, stops the server: a limit of zero refuses every form, and either is better caught at startup than by the first person who cannot get their password reset.

The trace attributes, span naming, sampling, and the list of `OTEL_*` variables are in [server/README.md](../../README.md#distributed-tracing-opentelemetry).

Revalidation requests are sent to every Next.js app on a publication state update only when `PUBLIRA_REVALIDATE_TOKEN` and all three `PUBLIRA_WEB_*_INTERNAL_URL` variables are set. The fixed path at each destination is `/api/v1/revalidate`.

`PUBLIRA_WEB_HOST_URL` is the public URL that Stripe Checkout returns the browser to, and is separate from this set of internal URLs.
