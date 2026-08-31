# `@publira/tracing`

The shared package that registers the OpenTelemetry SDK from the `instrumentation.ts` of the Next.js apps (`web-host` / `web-admin` / `web-platform`). It reads the same environment variables and uses the same defaults as [`server/internal/tracing`](../../server/internal/tracing) on the Go side, so a single deployment configuration lines the whole stack's traces up.

The registration itself is [`@vercel/otel`](https://www.npmjs.com/package/@vercel/otel). The spans Next.js already instruments (the inbound request, rendering, `fetch`) come out of this registration alone.

## Usage

```ts
// apps/web-host/instrumentation.ts
import { registerTracing } from "@publira/tracing";

export const register = async () => {
  await import("temporal-polyfill/global");
  registerTracing("publira-web-host");
};
```

The argument is the default `service.name`; `OTEL_SERVICE_NAME` and `OTEL_RESOURCE_ATTRIBUTES` override it. `@vercel/otel` ships builds for both the Node.js and the Edge runtime, so it does not break whichever one calls it.

## Environment variables

Only two variables are ours — the enable flag and the deployment environment. The OpenTelemetry SDK reads the rest itself, so those keep their own names.

| Variable | What it does |
| --- | --- |
| `PUBLIRA_TRACING_ENABLED` | Enables tracing (`true` / `1` / `t`, case-insensitive). Unset or unparseable means disabled |
| `PUBLIRA_DEPLOYMENT_ENVIRONMENT` | `development` (default) / `staging` / `production`. Decides `deployment.environment.name` and the default sampling rate |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Where to send spans (for example `http://jaeger:4318`) |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf` / `http/json`. `@vercel/otel` has no gRPC OTLP |
| `OTEL_SERVICE_NAME` / `OTEL_RESOURCE_ATTRIBUTES` | Overrides for the resource attributes |
| `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG` | The sampler. Setting it bypasses the defaults below and lets the SDK interpret the value |
| `NEXT_OTEL_VERBOSE` | `1` emits Next.js's detailed spans (off by default) |

**Tracing is off by default.** Without a recognized truthy `PUBLIRA_TRACING_ENABLED` (`true` / `1` / `t`), `registerTracing` registers nothing and Next.js's instrumentation records into OpenTelemetry's no-op provider. The app starts and serves requests with no collector in place.

## Resource attributes

| Key | Value |
| --- | --- |
| `service.name` | The argument to `registerTracing` (`publira-web-host` / `publira-web-admin` / `publira-web-platform`). Overridable with `OTEL_SERVICE_NAME` |
| `deployment.environment.name` | `PUBLIRA_DEPLOYMENT_ENVIRONMENT`, or `development` when unset |
| `node.env` / `process.runtime.name` | Runtime information `@vercel/otel` adds |

`@vercel/otel` adds `cloud.provider=vercel` and `vercel.runtime` even off Vercel. The values mean nothing in a self-hosted deploy, but they are harmless, so we do not strip them.

## Sampling

As on the Go side, sampling is parent-based, and only the treatment of a root span changes with the deployment environment. For a request from a browser the Next.js app is where the trace starts, so the decision made here carries straight through to the Go services downstream.

| `PUBLIRA_DEPLOYMENT_ENVIRONMENT`           | Root span |
| ------------------------------------------ | --------- |
| `development` (default)                    | All       |
| Anything else (`staging`, `production`, …) | 10%       |

## `NEXT_OTEL_VERBOSE`

By default Next.js emits only the spans on its own allowlist (`NextVanillaSpanAllowlist` in `next/dist/server/lib/trace/constants.js`). The request root span, rendering, `fetch`, `generateMetadata`, building the component tree, resolving segment modules, Route Handlers, and the proxy are all on it, so the default granularity already covers ordinary investigation.

`NEXT_OTEL_VERBOSE=1` also emits the internal spans outside the allowlist (`BaseServer.renderToResponse`, `Router.executeRoute`, `AppRender.renderToReadableStream`, `LoadComponents.loadComponents`, and so on). Set it only when you want to follow Next.js's own internals.

```bash
NEXT_OTEL_VERBOSE=1 pnpm --dir apps/web-host dev
```

It is not on by default because it multiplies the number of spans per request and fills the trace UI with internal stages that application code cannot move. If you are looking for slowness in your own code, it reads better without it.

## How a trace is joined up

| Segment | Instrumentation |
| --- | --- |
| Browser → the Next.js inbound | Built into Next.js (a root span such as `GET /[tenant_id]/[locale]`) |
| `proxy.ts` | Built into Next.js (`middleware GET`). It lands in a **separate trace** from the page render |
| SSR → the Go API over Connect / gRPC | The tracing interceptor in [`@publira/api-client`](../api-client) (the client span and sending `traceparent`) |
| The Go API's inbound and its DB queries | [`server/internal/tracing`](../../server/README.md#distributed-tracing-opentelemetry) |

Propagation is W3C Trace Context. The Go Connect handlers trust an inbound `traceparent` as the parent, so the web app, the API, and the database land in a single trace.
