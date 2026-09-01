# email-renderer

A Node.js ConnectRPC service that serves `EmailRendererService.RenderEmail` and turns the templates of `@publira/email-templates` into a subject, HTML, and plain text. It does not send anything over SMTP.

## Running it

```bash
pnpm --filter @publira/email-renderer dev
```

It listens on `0.0.0.0:8080` by default. `PORT` changes the port and `HOST` the bind address. In production, run `pnpm --filter @publira/email-renderer build` first and then `pnpm --filter @publira/email-renderer start`.

## RPC

`publira.email.v1.EmailRendererService/RenderEmail` takes `template`, `locale`, `data`, and `time_zone`, and returns `subject`, `html`, and `text`.

- `time_zone` is an IANA time zone name. Always pass the display time zone resolved for the tenant.
- An unknown template ID or invalid data returns `invalid_argument`.
- An unknown `locale` renders as `ja`, following the convention of the template package.

`GET /livez` always returns `200 ok`. `GET /readyz` has no dependency to check, so it returns `200` with `{ "status": "ok", "checks": {} }`.

## Production image

Build [`infra/docker/node/Dockerfile`](../../infra/docker/node/Dockerfile), the Dockerfile for long-running Node.js services, with the repository root as the build context.

```bash
task docker:build:node APP_NAME=email-renderer PORT=8080
task docker:smoke:node APP_NAME=email-renderer PORT=8080
```

The image runs as the distroless nonroot user and defaults to `HOST=0.0.0.0` and `PORT` (8080). It carries no shell, so it declares no `HEALTHCHECK`; configure the HTTP probes for `/livez` and `/readyz` in the orchestrator instead. For the layout conventions, see [`infra/docker/README.md`](../../infra/docker/README.md).
