# api-server

The public ConnectRPC API server.

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

- `PUBLIRA_PUBLIC_DB_URL` (optional; a development default is used when unset)
- `PUBLIRA_AUTH_JWT_SECRET` (required, at least 32 bytes. The HS256 signing key for access tokens. The server fails to start when it is unset. For the details, see the [repository README](../../../README.md#api-access-token-signing-key-publira_auth_jwt_secret))
- `PUBLIRA_S3_BUCKET` (required)
- `AWS_REGION` (optional)
- `PUBLIRA_S3_ENDPOINT` (optional)
- `PUBLIRA_S3_FORCE_PATH_STYLE` (optional)
- `PUBLIRA_S3_PUBLIC_BASE_URL` (optional)
- `PUBLIRA_REDIS_URL` (optional. Where the counters behind the reader write limits and the mail limits below are kept. Unset / `disabled` / `off` / `false` limits each instance on its own, which is looser than a shared limit by the number of instances)
- `PUBLIRA_COMMENT_POST_LIMIT_PER_MINUTE` (optional, `10` when unset. How many comments one reader may post in a minute)
- `PUBLIRA_COMMENT_POST_LIMIT_PER_DAY` (optional, `100` when unset. How many comments one reader may post in a day)
- `PUBLIRA_COMMENT_REPORT_LIMIT_PER_MINUTE` (optional, `10` when unset. How many comments one reader may report in a minute)
- `PUBLIRA_COMMENT_REPORT_LIMIT_PER_DAY` (optional, `50` when unset. How many comments one reader may report in a day)
- `PUBLIRA_COMMENT_DUPLICATE_WINDOW_MINUTES` (optional, `10` when unset. How long the same body by the same reader on the same episode is refused)
- `PUBLIRA_MAIL_REQUEST_LIMIT_PER_ADDRESS_PER_HOUR` (optional, `5` when unset. How much mail the forms that take an address may cause for one address in an hour, counted per tenant and shared by all of them)
- `PUBLIRA_MAIL_REQUEST_LIMIT_PER_ADDRESS_PER_DAY` (optional, `20` when unset. The same allowance over a day)
- `PUBLIRA_MAIL_REQUEST_LIMIT_PER_SOURCE_PER_HOUR` (optional, `30` when unset. How much such mail one origin may cause in an hour, across every address and tenant)
- `PUBLIRA_MAIL_REQUEST_LIMIT_PER_SOURCE_PER_DAY` (optional, `150` when unset. The same allowance over a day)
- `PUBLIRA_REVALIDATE_TOKEN` (optional, the shared token sent in the `X-Revalidate-Token` header)
- `PUBLIRA_WEB_HOST_INTERNAL_URL` / `PUBLIRA_WEB_ADMIN_INTERNAL_URL` / `PUBLIRA_WEB_PLATFORM_INTERNAL_URL` (all required when `PUBLIRA_REVALIDATE_TOKEN` is set. The private network URL of each Next.js app)
- `PUBLIRA_TRACING_ENABLED` (optional, disabled by default. Enables OpenTelemetry tracing)
- `PUBLIRA_DEPLOYMENT_ENVIRONMENT` (optional, `development` when unset. Determines `deployment.environment.name` and the default sampling rate)

A reader write limit or a mail limit below `1`, or one that is not a whole number, stops the server at startup rather than taking effect: a limit of zero would refuse every reader and every request for mail, and that is better caught before the server serves anything than by the first reader who runs into it.

The trace attributes, span naming, sampling, and the list of `OTEL_*` variables are in [server/README.md](../../README.md#distributed-tracing-opentelemetry).

## Notes

- The default listen address is `:8000`.
