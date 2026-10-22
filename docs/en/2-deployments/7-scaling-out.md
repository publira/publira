---
title: Scaling out
description: What to run more of when an install outgrows what it started on, what every copy has to share, and the parts that do not scale out.
published: 2026-10-22
---

An install that has become slow, or is about to grow, gets more of the processes it already runs: more copies of the busy ones, and `publira server` split by the traffic it answers. This page says which processes can run more than once and what has to be in place before they do, where the load of an install goes, how far `publira server` can be split, what the database has to accept as the copies multiply, and which parts no number of copies relieves. It applies on any platform: [Kubernetes](./5-kubernetes/index.md) and [Amazon ECS on Fargate](./6-ecs-fargate/index.md) have the manifests and commands.

## What can run more than once

Every long-lived process may run any number of copies: `publira server`, `publira worker`, `web-storefront`, `web-admin`, `web-platform`, and `email-renderer`. None of them keeps state of its own that a second copy would need:

- **What an install stores is in PostgreSQL and the object store.** Every row is in the database and every uploaded image in the bucket, so a copy started anywhere serves the same install.
- **A session is a cookie.** A web app seals the reader's or the staff member's session into an encrypted cookie the browser sends back with every request, and the API checks the access token inside it on every call. Any copy of the app opens a session another copy issued, so the edge needs no sticky sessions. Every copy of one app therefore needs the same `PUBLIRA_AUTH_SECRET`, and every copy of `publira server` the same `PUBLIRA_AUTH_JWT_SECRET` and secret encryption keys.
- **The settings are read from the database, not from the process.** A saved platform policy reaches every running copy of `publira server` within ten seconds, and a saved object store or search engine reaches every copy of the server and the worker within 30 seconds. Saving a setting therefore needs no restart, and no copy is left on the old value.
- **What the copies share at run time is in Valkey.** The rate limit counters, the converted images, and the web apps' page cache are kept there rather than in a process's memory, as [What has to be shared first](#what-has-to-be-shared-first) describes.

Every process can therefore also be the target of the platform's autoscaling, such as a Kubernetes HorizontalPodAutoscaler or ECS service auto scaling. Size the database for the most copies the autoscaling may start, as [The database connection budget](#the-database-connection-budget) works out.

## What has to be shared first

Before any process runs a second copy, every process of the install has to be given the same Valkey, or any Redis-protocol server: `PUBLIRA_REDIS_URL` on `publira server`, and `PNCH_REDIS_URL` on `web-storefront`, `web-admin`, and `web-platform`. [Installing](./2-installing.md#provision-the-services) already provisions it, and it holds three things:

| What | Kept by | Without a shared Valkey |
| --- | --- | --- |
| The rate limit counters: the reader write limits, the step-up password limit, and the mail limits | `publira server` | Each copy counts on its own, so a reader whose requests are spread across three copies gets three times the limit. [Where the counts are kept](../3-operations/9-platform-policies.md#where-the-counts-are-kept) has the details |
| The converted images | `publira server` | Each copy keeps the images it converted in its own memory, so every copy converts the same image again |
| The pages and data the web apps cache | `web-storefront`, `web-admin`, `web-platform` | Nothing a web app renders is cached: every request renders its page again and calls `publira server` for everything on it |

Each web app keeps its entries under a key prefix of its own, so the apps share the server without sharing entries. When a write leaves a cached page stale, the server's cache revalidation reaches one copy of each web app, and that copy records the drop in Valkey, where every other copy reads it: the cache stays current however many copies run. `publira worker` and `email-renderer` do not use Valkey.

## Where the load goes

The traffic of an install falls on three groups of processes, and each grows on its own:

| Traffic | Processes | What to add |
| --- | --- | --- |
| Readers: the tenants' sites and the mobile app | `web-storefront`, and the public API and images of `publira server` | Copies of `web-storefront`, and of the `publira server` the tenants' domains reach |
| Staff and operators: the consoles | `web-admin`, `web-platform`, and the `publira server` they call | Copies of the consoles and of their `publira server`, rarely as many |
| Background work: mail, push notifications, cache revalidation, scheduled jobs | `publira worker` | Copies of the worker |

### Readers

Converting images is the heaviest work an install does. `publira server` resizes every image a page shows and converts it to WebP or AVIF on request, and keeps the result in Valkey for `PUBLIRA_IMAGE_CACHE_TTL`, an hour unless set, so one copy converts an image and every other copy serves the cached result until it expires. What the cache does not hold yet is converted on the copy the request reached, so the processes that serve the tenants' images are the ones whose CPU a growing site uses up first.

A CDN in front of the edge takes much of that work away. `publira server` marks an image anyone may be shown, such as the pages of a free episode or a tenant's logo, `public, max-age=3600`, or shorter when a free reading period ends sooner, and an image that needs the reader's credential `private`. A CDN can serve the public ones without asking the install again within the hour. Its cache key has to include the host, the `Accept` header, the `Authorization` header, and the whole query string, as [The cache policies](./6-ecs-fargate/1-cloudfront.md#the-cache-policies) sets up for CloudFront. Nothing but `/images` is worth caching at the CDN: the pages depend on the reader's session, and the web apps cache them already.

### Background work

Every `publira worker` copy runs every kind of work the worker does, and no piece of work runs on two copies:

- **The outbox**, which sends mail and push notifications and revalidates the web apps' caches, is spread across the copies. Every `PUBLIRA_OUTBOX_DRAIN_INTERVAL`, two seconds unless set, one copy claims up to `PUBLIRA_OUTBOX_CLAIM_LIMIT` due entries, a hundred unless set, and queues a job for each. Any copy then runs those jobs, up to `PUBLIRA_OUTBOX_MAX_WORKERS` at once on each, eight unless set, and each job on one copy alone. More copies send more entries at once, which helps when sending is slow, but the outbox still takes at most `PUBLIRA_OUTBOX_CLAIM_LIMIT` entries per interval however many copies run.
- **The scheduled jobs**, the ones that publish episodes at their scheduled time, open and close free reading periods, and rebuild and purge stored data, are each run by one copy at a time. A job is unique while a run of it is in flight, so a second copy schedules no second run of it, and a run that outlasts its interval is not started again underneath itself.
- **The rebuilds and purges** run one at a time on each copy. Two copies may run two different ones at the same time, but never the same one. A copy does not yet take only some of the work, so a copy busy with an hour-long rebuild is also one of the copies sending mail ([#4746](https://github.com/publira/publira/issues/4746)).

More copies therefore mean more mail and push notifications sent at once, not faster rebuilds or more scheduled passes. [Scheduled jobs](../3-operations/10-scheduled-jobs.md) says what each job does, and the [`publira worker` reference](https://github.com/publira/publira/blob/main/server/cmd/publira/README.md#publira-worker) lists every variable that tunes it.

## Splitting the server by role

`publira server` serves the public API, both consoles' APIs, and the images in one process, and can be split by what it serves. Each step below keeps what the one before it bought:

1. **One process.** `publira server --with-worker` runs the server and the worker together, as the [Docker Compose](./3-docker-compose.md) install does. Adding a copy adds both.
2. **The server and the worker apart.** `publira server` and `publira worker` as two processes, as [Installing](./2-installing.md) runs them. Each is scaled on its own, and the worker's database logins are no longer in the process the edge forwards to.
3. **A server for the readers.** A second `publira server`, run with `--role storefront`, takes the public API and the images of every tenant's domain, and `web-storefront`'s `PUBLIRA_GRPC_URL` names it too, since `web-storefront` calls the public API alone. The first keeps serving `web-admin`, `web-platform`, and the console hosts. All reader traffic then reaches processes of its own, which you scale apart from the consoles, and those processes hold neither console's database login nor the web service credential. [The deployment reference](https://github.com/publira/publira/blob/main/infra/deploy/README.md#long-lived-processes) lists what each of the two reads.
4. **Copies of each.** Run as many copies of each process as its traffic needs.

Step 3 is the finest split by role an install can make today. `web-admin` calls the public API for the tenant's theme and catalog as well as the tenant console's API, through its one `PUBLIRA_GRPC_URL`, so the process it calls serves every role, and a `publira server --role admin,platform` cannot stand behind it ([#4745](https://github.com/publira/publira/issues/4745)).

The edge can still keep image conversion off the processes that answer the public API. It routes `/images` and `/rpc/publira.v1.` on the tenants' domains by path, so each can go to a group of `--role storefront` processes of its own: one group converts images, and the other answers the API, each with as many copies as its traffic needs. `web-storefront` calls the API group, since it never fetches an image itself. Nothing changes in the processes themselves, only the backend the edge forwards each path to and the URL `web-storefront` is given. Keep the console hosts' `/images` and `/rpc/publira.v1.` on the `publira server` `web-admin` calls, since a `--role storefront` process answers a console host's images with `404`. Serving a tenant's images from a host name of its own is not documented yet ([#4657](https://github.com/publira/publira/issues/4657)).

Kubernetes and ECS have the resources for step 3: [Keeping the consoles' credentials off the tenants' domains](./5-kubernetes/2-operating.md#keeping-the-consoles-credentials-off-the-tenants-domains) on Kubernetes, and [the same section](./6-ecs-fargate/2-operating.md#keeping-the-consoles-credentials-off-the-tenants-domains) on ECS.

## The database connection budget

Every copy of `publira server` and `publira worker` opens one pool of connections per database login it signs in as, and each pool holds at most `PUBLIRA_DB_MAX_OPEN_CONNS` connections, ten unless set. The web apps and `email-renderer` open none. The database therefore has to accept:

```text
(the pools of every copy of publira server and publira worker, summed) × PUBLIRA_DB_MAX_OPEN_CONNS
```

| Process | Pools per copy |
| --- | --- |
| `publira server` | 3 |
| `publira server --role <roles>` | 1 per role it is given: 1 for `--role storefront` |
| `publira server --with-worker` | 6 |
| `publira worker` | 3 |
| A `publiractl` command while it runs | 1 |

The sum has to fit in the database's `max_connections`, less the connections PostgreSQL keeps for superusers, `superuser_reserved_connections`, three unless set. One server and one worker take 60 of PostgreSQL's default 100. An install with three copies of `publira server --role storefront`, two of `publira server`, and two of `publira worker` takes (3 × 1 + 2 × 3 + 2 × 3) × 10 = 150, which the default no longer accepts.

A request to the public API holds one connection of the public API's pool from start to end, and a request to the tenant console's API one of the console's pool, and one connection of each pool is kept for the queries those requests make outside a tenant. A copy therefore answers at most one less than `PUBLIRA_DB_MAX_OPEN_CONNS` public API requests at once, and as many tenant console requests beside them when it serves both. Raising the bound lets each copy answer more, and adding copies does too; both cost connections at the database. [Connection pools](https://github.com/publira/publira/blob/main/server/README.md#connection-pools) has the full reference.

## What does not scale out

Copies of the processes spread their own work. The services they depend on are each one service to Publira, and making any of them larger, or highly available behind the one address Publira is given, is done in that service:

- **PostgreSQL.** Each pool connects to the one URL its variable names, so every read and every write goes to one primary. Publira does not send reads to a replica ([#4747](https://github.com/publira/publira/issues/4747)), which makes the database where the load of a growing install ends up: more copies of the processes send it more queries, and only a larger database relieves it.
- **Valkey.** Every process reads one URL.
- **The object store.** The install has one bucket, saved in the platform's settings.
- **The SMTP server.** The worker sends every mail through the SMTP server the settings name.
- **The search engine**, when the install runs one. The install has one, saved in the platform's settings.

## Running several copies day to day

### Stopping a copy

`publira server` and `publira worker` stop within 30 seconds of a `SIGTERM`: they finish the requests and jobs in flight, and then close their connections. Give the platform a grace period longer than that before it kills the process, such as a `terminationGracePeriodSeconds` of 45 on Kubernetes, where the default is 30, or a `stopTimeout` of 45 seconds in the container definition on ECS, where the default is 30 too. Work cut off at the deadline is not lost. A scheduled job left running is taken up again by the job queue, and each is safe to repeat. An outbox entry left in processing goes back to the queue after `PUBLIRA_OUTBOX_STALE_PROCESSING`, fifteen minutes unless set, and is sent then: delivery is at least once, so an entry whose mail or push notification went out just before the copy was killed is sent a second time.

`publira server` stops accepting connections as soon as it is told to stop, and does not first answer `/readyz` as not ready. The edge therefore has to stop sending a copy requests before the copy is stopped. On ECS it does: the service takes a task out of its Application Load Balancer target group, and waits for the target to drain, before it stops the task. On Kubernetes, a Pod leaves its Service's endpoints at the same time as it is sent `SIGTERM`, so a request may still reach it in the first moments; a `preStop` hook that waits a few seconds, such as one with the `sleep` action, closes that gap. The edge sends a new copy requests once its `/readyz` answers ready, as [Health checks](../3-operations/11-monitoring.md#health-checks) describes.

### Restarting the copies

A change that keeps the release, such as a new value of a variable, can be rolled out one copy at a time, and the install keeps serving while it is. A saved setting needs no restart at all. A new release is different: [Upgrading](./8-upgrading.md#decide-whether-to-stop-the-processes-first) has you replace every process together rather than one copy at a time, because the copies of two releases do not promise to agree on the API or on the schema.

### Backups

A backup keeps the worker stopped from before the database backup until the bucket copy ends, and that means every copy of it, as [Stop the worker](./9-backup-and-restore.md#1-stop-the-worker) describes. On an install that runs `publira server --with-worker`, that is every copy of that process, and the server stops with it.

## Next steps

[Upgrading](./8-upgrading.md) brings an install with any number of copies to a new release. [Monitoring](../3-operations/11-monitoring.md) has the metrics and the logs to watch the load with.
