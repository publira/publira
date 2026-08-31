# api-server

The public ConnectRPC API server.

## Running

From the repository root:

```bash
make dev-api
```

From the `server` directory:

```bash
go run ./cmd/api-server
```

Using a pre-built binary:

```bash
cd server && make build
./bin/api-server
```

## Main environment variables

- `PUBLIRA_PUBLIC_DB_URL` (optional; a development default is used when unset)
- `PUBLIRA_AUTH_JWT_SECRET` (required, at least 32 bytes. The HS256 signing key for access tokens. The server fails to start when it is unset. For the details, see the [repository README](../../../README.md#api-access-token-signing-key-publira_auth_jwt_secret))
- `PUBLIRA_S3_BUCKET` (required)
- `AWS_REGION` (optional)
- `PUBLIRA_S3_ENDPOINT` (optional)
- `PUBLIRA_S3_FORCE_PATH_STYLE` (optional)
- `PUBLIRA_S3_PUBLIC_BASE_URL` (optional)
- `PUBLIRA_TRACING_ENABLED` (optional, disabled by default. Enables OpenTelemetry tracing)
- `PUBLIRA_DEPLOYMENT_ENVIRONMENT` (optional, `development` when unset. Determines `deployment.environment.name` and the default sampling rate)

The trace attributes, span naming, sampling, and the list of `OTEL_*` variables are in [server/README.md](../../README.md#distributed-tracing-opentelemetry).

## Notes

- The default listen address is `:8000`.
