# admin-api-server

The admin ConnectRPC API server.

## Running

From the repository root:

```bash
make dev-admin-api
```

From the `server` directory:

```bash
go run ./cmd/admin-api-server
```

Using a pre-built binary:

```bash
cd server && make build
./bin/admin-api-server
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
- `PUBLIRA_REVALIDATE_TOKEN` (optional, the shared token sent in the `X-Revalidate-Token` header)
- `PUBLIRA_WEB_HOST_INTERNAL_URL` / `PUBLIRA_WEB_ADMIN_INTERNAL_URL` / `PUBLIRA_WEB_PLATFORM_INTERNAL_URL` (all required when `PUBLIRA_REVALIDATE_TOKEN` is set. The private network URL of each Next.js app)
- `PUBLIRA_TRACING_ENABLED` (optional, disabled by default. Enables OpenTelemetry tracing)
- `PUBLIRA_DEPLOYMENT_ENVIRONMENT` (optional, `development` when unset. Determines `deployment.environment.name` and the default sampling rate)

The trace attributes, span naming, sampling, and the list of `OTEL_*` variables are in [server/README.md](../../README.md#distributed-tracing-opentelemetry).

Revalidation requests are sent to every Next.js app on a publication state update only when `PUBLIRA_REVALIDATE_TOKEN` and all three `PUBLIRA_WEB_*_INTERNAL_URL` variables are set. The fixed path at each destination is `/api/v1/revalidate`, and tags are sent as they are, without a tenant ID restriction. Revalidation does not depend on the tenant domain in `Host` / `X-Forwarded-Host`, and does not go through the reverse proxy. If any URL is missing or malformed, revalidation is disabled and the reason is logged.

`PUBLIRA_WEB_HOST_URL` is the public URL that Stripe Checkout returns the browser to, and is separate from this set of internal URLs.
