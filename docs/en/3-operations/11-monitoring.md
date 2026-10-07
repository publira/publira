---
title: Monitoring
description: Probing every process with /livez and /readyz, the log lines and metrics worth alerting on, and turning on OpenTelemetry metrics and traces.
published: 2026-10-07
---

An install tells you how it is doing in four ways: every process answers a liveness and a readiness check, `publira server` and `publira worker` write a structured log, the same two export OpenTelemetry metrics once you turn them on, and every process but `email-renderer` can export OpenTelemetry traces. This page says what each of them reports, how to wire them into an orchestrator and an alerting system, and what is worth an alert. Which monitoring system receives them is your choice; the page names only what an install sends.

The variables are described in full in the [`publira server` and `publira worker` reference](https://github.com/publira/publira/blob/main/server/cmd/publira/README.md), the [server's tracing and metrics reference](https://github.com/publira/publira/blob/main/server/README.md#distributed-tracing-opentelemetry), and the [web apps' tracing reference](https://github.com/publira/publira/blob/main/packages/tracing/README.md); this page links to them rather than repeating them.

## Health checks

Every process answers two requests over plain HTTP:

- **`GET /livez`** answers `200` with the text `ok` whenever the process can answer at all. It checks nothing else, so it fails only when the process has hung or stopped.
- **`GET /readyz`** checks what the process depends on and answers `200` when every check passes, and `503` when any one fails. The body names each check.

| Process | Port | What `/readyz` checks |
| --- | --- | --- |
| `publira server`, internal listener | `8100` (`PUBLIRA_PUBLIC_API_GRPC_ADDR`) | Each of its three database logins: `db.public`, `db.admin`, and `db.platform` |
| `publira server`, edge listener | `8000` (`PUBLIRA_PUBLIC_API_ADDR`) | The `publira_public` login alone, as `db`: the only one the public API uses |
| `publira worker` | `8003` (`PUBLIRA_WORKER_ADDR`) | Each of its three database logins: `db.outbox`, `db.ticker`, and `db.content_stats`. It also answers not ready until its job queue has started |
| `web-host`, `web-admin`, `web-platform` | `PORT`: `3000`, `4000`, and `4100` in the images as the repository builds them | `api`, the `/readyz` of `publira server`'s internal listener, at `PUBLIRA_GRPC_URL`; and `redis`, a ping to the shared cache at `PNCH_REDIS_URL`, which always passes while that cache is turned off |
| `email-renderer` | `8080` (`PORT`) | Nothing: it depends on no other service, so it is ready whenever it is up |

None of them checks the object store, the SMTP server, or the search engine. A failure there shows in the log and in what readers see, not in `/readyz`.

A healthy answer looks like this:

```json
{
  "status": "ok",
  "checks": {
    "db.outbox": { "status": "ok" },
    "db.ticker": { "status": "ok" },
    "db.content_stats": { "status": "ok" }
  }
}
```

`status` is `ok` when every check passed, `unavailable` when one failed, and `starting` while the worker's job queue has not started yet. A failed check carries an `error` that says only which kind of failure it was — `timeout`, `dependency_failed`, or `not configured` — and never a host name or a connection string, so the answer is safe to show anyone. The reason itself goes to the process's log, as a `readiness check failed` line naming the check.

Each check is given two seconds. `publira server` and `publira worker` run their checks one after another, so when every login hangs their answer takes about six seconds; the web apps run theirs side by side and answer within about two.

### Probing from an orchestrator

Point the liveness probe of every process at `/livez`, and its readiness probe at `/readyz`. Never use `/readyz` as a liveness probe: a database that stops answering would make the orchestrator restart every process at once, which does not bring the database back and takes away whatever the processes could still serve from cache.

A web app's `/readyz` fails whenever the internal listener's `/readyz` does, so one database login that stops answering makes every web app not ready together with `publira server`. That is deliberate — a web app that cannot reach a working API cannot serve a page that is not cached — but it means a load balancer that follows readiness stops sending traffic to all of them at once. Decide whether that is what you want from your load balancer before you point it at `/readyz`.

Give a `/readyz` probe of `publira server` or `publira worker` a timeout longer than six seconds, so that a slow check is reported as the failure it names rather than as a probe timeout. On Kubernetes, the worker's probes look like this:

```yaml
livenessProbe:
  httpGet:
    path: /livez
    port: 8003
readinessProbe:
  httpGet:
    path: /readyz
    port: 8003
  timeoutSeconds: 8
```

The images carry no shell and declare no Docker `HEALTHCHECK`, so the [Docker Compose](../2-deployments/3-docker-compose.md) install has no probes of its own: Compose restarts a process that exits, not one that hangs. Probe it from outside instead, from a monitor that can reach the containers' network. The tenant site's `/livez` and `/readyz` are also reachable through the reverse proxy on every tenant's domain, such as `https://comics.example.com/readyz`, which an uptime monitor on the internet can use; the API's and the worker's are not, since the proxy forwards only `/api` and `/images` to `publira server`.

## Logs

`publira server`, `publira worker`, and `publiractl` write their log to standard output, one record per line, as `key=value` pairs:

```text
time=2026-10-07T09:41:03.402Z level=ERROR msg="outbox event dead" event_id=0199b5f0-1c2e-7c41-9a8e-3f5d2a6b7c80 event_type=contact_message_reply_email idempotency_key=… attempts=10 trace_id=4bf92f3577b34da6a3ce929d0e0e4736 span_id=00f067aa0ba902b7 error="dial tcp: connection refused"
```

Every record has `time`, `level` (`INFO`, `WARN`, or `ERROR`), and `msg`. A record logged while handling a request or a job that is being traced also has `trace_id` and `span_id`, which lead to that trace in your tracing backend. The rest depends on what logged it: the outbox's records name the entry (`event_id`, `event_type`, `attempts`), a maintenance job's name the run (`job_kind`, `job_id`, `attempt`), and a failure carries `error`. The level is fixed at `INFO`: there is no variable to make the log quieter or more detailed.

The web apps and `email-renderer` write Next.js's and Node.js's own plain-text output instead. Their failures are lines prefixed with the app's name, such as `[web-host] getTenantSiteInfo failed`, and a readiness check that failed is logged as `health check api failed`.

### What to alert on

An alert on every `level=ERROR` record of `publira server` and `publira worker` is a reasonable start: a request the API could not answer is logged at that level, with the error behind it. These records are worth an alert of their own, because each one means something was lost or is stuck:

| Record | Process | What it means |
| --- | --- | --- |
| `outbox event dead` | `publira worker` | A mail, a push notification, or a cache revalidation was given up for good. `event_type` says which; [The outbox](./10-scheduled-jobs.md#seeing-what-was-given-up) says what it costs |
| `outbox event retry scheduled`, repeated | `publira worker` | Whatever the entries are sent to — the SMTP server, `email-renderer`, a web app — is failing. They are retried for about nine minutes before they become dead |
| `episode publish failed after all retries` | `publira worker` | A scheduled episode stayed **Scheduled**. The tenant's administrators and every operator are also notified, as [Scheduled publication](./10-scheduled-jobs.md#scheduled-publication) describes |
| `auditlog: queue is full; dropping entry`, `auditlog: failed to persist; dropping entry` | `publira server` | An entry of the tenant's or the platform's audit log was lost |
| `readiness check failed` | `publira server`, `publira worker` | The check it names failed; the `error` field says why |
| `opentelemetry error` | `publira server`, `publira worker` | Metrics or traces could not be exported, usually because the collector is unreachable |
| `failed to initialize …` | `publira server`, `publira worker` | The process could not start and exited. The orchestrator restarts it, and the same line comes back until the cause is fixed |

How the worker's scheduled jobs record their failures, in the log and in the `river_job` table, is in [Where a job's failures are recorded](./10-scheduled-jobs.md#where-a-jobs-failures-are-recorded).

## Metrics

`publira server` and `publira worker` export OpenTelemetry metrics once `PUBLIRA_METRICS_ENABLED=true` is set on them. Without it they export none. The web apps and `email-renderer` export no metrics.

Choose how they are exported with `OTEL_METRICS_EXPORTER`:

- **`otlp`**, the default, pushes them every 60 seconds to `OTEL_EXPORTER_OTLP_ENDPOINT`, the same collector address the traces use.
- **`prometheus`** serves them for a Prometheus scraper at `/metrics` on port `9464`. Set `OTEL_EXPORTER_PROMETHEUS_HOST=0.0.0.0` as well: the default, `localhost`, cannot be reached from outside the container.

The other variables, and the full list of what is recorded, are in the [metrics reference](https://github.com/publira/publira/blob/main/server/README.md#metrics-opentelemetry). Each process reports under one `service.name`: `publira-api-server` for `publira server` and `publira-worker` for `publira worker`.

### The outbox

The worker's metrics follow the outbox, through which every mail, push notification, and cache revalidation is sent, as [The outbox](./10-scheduled-jobs.md#the-outbox-mail-push-and-cache-revalidation) describes. Each carries the entry's kind as `outbox.event_type`.

| Metric | What it counts | What to watch |
| --- | --- | --- |
| `publira.outbox.events.dead` | Entries given up for good | Any increase. Alert on it |
| `publira.outbox.events.retry` | Failed attempts that will be tried again | A rate that stays up: the destination of that `outbox.event_type` is failing |
| `publira.outbox.events.claimed` | Entries the worker picked up to send | Compared with `done`: claimed entries that do not end up done are failing or stuck |
| `publira.outbox.events.done` | Entries sent | — |
| `publira.outbox.events.resumed` | Entries put back to continue later after sending part of their work, such as a push notification to many readers | — |
| `publira.outbox.handler.duration` | How long one attempt took, in seconds | A rise: the SMTP server, `email-renderer`, or a web app is slowing down |

The counters say what the worker did, not what is still waiting. A worker that has stopped claiming entries reports nothing at all, so watch its `/readyz` alongside them, or count the entries that are due and unsent with `psql`, connected as the database's superuser:

```sql
SELECT count(*), min(available_at)
FROM outbox_events
WHERE status = 'pending' AND available_at < now() - interval '5 minutes';
```

A healthy worker sends an entry within a few seconds of it becoming due, so a count that stays above zero means the worker is not draining.

### The audit log

`publira server` writes the audit logs of the tenant console and the Platform Console through a queue, so a request does not wait for its entry. `publira.auditlog.queue.depth` is the number of entries waiting, and `publira.auditlog.entries.dropped` counts the entries lost, by `auditlog.drop_reason`. Alert on any drop, and on a queue depth that keeps growing: the database is not keeping up. The rest of the audit log's metrics are in its [reference](https://github.com/publira/publira/blob/main/server/README.md#operational-monitoring-for-the-asynchronous-audit-log).

## Tracing

Every process but `email-renderer` exports OpenTelemetry traces once `PUBLIRA_TRACING_ENABLED=true` is set on it. Turn it on for `publira server`, `publira worker`, and the web apps together: a page request is then one trace, from the web app through the API to the database queries it made.

Point them at your collector with the variables the OpenTelemetry SDK reads itself:

| Variable | What to set |
| --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | The collector, such as `http://otel-collector:4318` |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf`. `publira server` and `publira worker` also accept `grpc`, but the web apps do not, so `http/protobuf` is the value that works for every process |
| `PUBLIRA_DEPLOYMENT_ENVIRONMENT` | `production`, or the name of the environment. It is recorded on every span, and decides the sampling below |

Each process reports under a `service.name` of its own: `publira-api-server`, `publira-admin-api-server`, and `publira-platform-api-server` for the three APIs `publira server` serves, `publira-image-server` for its image delivery, `publira-worker` and a name per scheduled job for `publira worker`, and `publira-web-host`, `publira-web-admin`, and `publira-web-platform` for the web apps. The full list, and what is recorded on each span, is in the [server's tracing reference](https://github.com/publira/publira/blob/main/server/README.md#distributed-tracing-opentelemetry). The health checks of `publira server` are not traced, so a probe does not fill the backend with a trace every few seconds.

### Sampling

With `PUBLIRA_DEPLOYMENT_ENVIRONMENT` unset, every process counts itself as `development` and records every trace. Any other value records one trace in ten. The decision is made once, where the trace starts, and every process the request goes on to reaches keeps it, so a trace is recorded either whole or not at all. Set the same value on every process.

To sample at another rate, set the SDK's own `OTEL_TRACES_SAMPLER` and `OTEL_TRACES_SAMPLER_ARG`, such as `parentbased_traceidratio` and `0.25`, which replace the default on every process they are set on.

### Why the reverse proxy removes trace headers

Every process trusts the trace context a request arrives with: a `traceparent` header makes its span part of the caller's trace, and carries the caller's sampling decision. That is what joins the web app's span to the API's. A browser or the mobile app could send the same header, though, and with it attach its spans to a trace of someone else's, or mark every request as sampled and export a trace for each one past the one-in-ten rate.

So the reverse proxy removes `traceparent`, `tracestate`, and `baggage` from every request it forwards, and every request from outside starts a new trace. The web apps call the API, and the API and the worker call the web apps, directly on the private network rather than through the proxy, so their trace context is kept. Every sample configuration in the repository does this, as [The headers the proxy owns](../2-deployments/4-reverse-proxy.md#the-headers-the-proxy-owns) describes; a proxy configured by hand has to remove the same three headers.
