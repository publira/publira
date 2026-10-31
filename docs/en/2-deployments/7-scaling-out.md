---
title: Scaling out
description: What to run more of when an install outgrows what it started on, what every copy has to share, and the parts that do not scale out.
published: 2026-10-22
updated: 2026-10-31
---

An install that has become slow, or is about to grow, gets more of the processes it already runs: more copies of the busy ones, `publira server` split by the traffic it answers, and `publira worker` split by the work it does. This page says which processes can run more than once and what has to be in place before they do, where the load of an install goes, how far `publira server` can be split, how `publira worker` is split, what the database has to accept as the copies multiply, how the readers' catalog reads and the worker's daily rebuilds move to a replica of the database, and which parts no number of copies relieves. It applies on any platform: [Kubernetes](./5-kubernetes/index.md) and [Amazon ECS on Fargate](./6-ecs-fargate/index.md) have the manifests and commands.

## What can run more than once

Every long-lived process may run any number of copies: `publira server`, `publira worker`, `web-storefront`, `web-admin`, `web-platform`, and `email-renderer`. None of them keeps state of its own that a second copy would need:

- **What an install stores is in PostgreSQL and the object store.** Every row is in the database and every uploaded image in the bucket, so a copy started anywhere serves the same install.
- **A session is a cookie.** A web app seals the reader's or the staff member's session into an encrypted cookie the browser sends back with every request, and the API checks the access token inside it on every call. Any copy of the app opens a session another copy issued, so the edge needs no sticky sessions. Every copy of one app therefore needs the same `PUBLIRA_AUTH_SECRET`, and every copy of `publira server` the same `PUBLIRA_AUTH_JWT_SECRET` and secret encryption keys.
- **The settings are read from the database, not from the process.** A saved platform policy reaches every running copy of `publira server` within ten seconds, and a saved object store or search engine reaches every copy of the server and the worker within 30 seconds. Saving a setting therefore needs no restart, and no copy is left on the old value.
- **What the copies share at run time is in Valkey.** The rate limit counters, the converted images, and the web apps' page cache are kept there rather than in a process's memory, as [What has to be shared first](#what-has-to-be-shared-first) describes.

Every process can therefore also be the target of the platform's autoscaling, such as a Kubernetes HorizontalPodAutoscaler or ECS service auto scaling. Size the database for the most copies the autoscaling may start, as [The database connection budget](#the-database-connection-budget) works out.

## What has to be shared first

Before any process runs a second copy, every process that uses Valkey, or any Redis-protocol server, has to be given the same one: `PUBLIRA_REDIS_URL` on `publira server`, and `PNCH_REDIS_URL` on `web-storefront`, `web-admin`, and `web-platform`. [Installing](./2-installing.md#provision-the-services) already provisions it, and it holds three things:

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

Every `publira worker` copy runs every kind of work the worker does unless it is given only some, and no piece of work runs on two copies:

- **The outbox**, which sends mail and push notifications and revalidates the web apps' caches, is spread across the copies. Every `PUBLIRA_OUTBOX_DRAIN_INTERVAL`, two seconds unless set, one copy claims up to `PUBLIRA_OUTBOX_CLAIM_LIMIT` due entries, a hundred unless set, and queues a job for each. Any copy then runs those jobs, up to `PUBLIRA_OUTBOX_MAX_WORKERS` at once on each, eight unless set, and each job on one copy alone. More copies send more entries at once, which helps when sending is slow, but the outbox still takes at most `PUBLIRA_OUTBOX_CLAIM_LIMIT` entries per interval however many copies run.
- **The scheduled jobs**, the ones that publish episodes at their scheduled time, open and close free reading periods, and rebuild and purge stored data, are each run by one copy at a time. A job is unique while a run of it is in flight, so a second copy schedules no second run of it, and a run that outlasts its interval is not started again underneath itself.
- **The rebuilds and purges** run one at a time across every copy. A copy whose turn comes while another copy is running one waits until that one ends, rather than starting beside it, and the wait is not counted as a failed run. A copy that runs every kind of work and is busy with an hour-long rebuild is also one of the copies sending mail, which [Splitting the worker by queue](#splitting-the-worker-by-queue) avoids.

More copies therefore mean more mail and push notifications sent at once, not faster rebuilds or more scheduled passes. [Scheduled jobs](../3-operations/10-scheduled-jobs.md) says what each job does, and the [`publira worker` reference](https://github.com/publira/publira/blob/main/server/cmd/publira/README.md#publira-worker) lists every variable that tunes it.

## Splitting the server by role

`publira server` serves the public API, both consoles' APIs, and the images in one process, and can be split by what it serves. Each step below keeps what the one before it bought:

1. **One process.** `publira server --with-worker` runs the server and the worker together, as the [Docker Compose](./3-docker-compose.md) install does. Adding a copy adds both.
2. **The server and the worker apart.** `publira server` and `publira worker` as two processes, as [Installing](./2-installing.md) runs them. Each is scaled on its own, and the worker's database logins are no longer in the process the edge forwards to.
3. **A server for the readers.** A second `publira server`, run with `--role storefront`, takes the public API and the images of every tenant's domain, and `web-storefront`'s `PUBLIRA_GRPC_URL` names it too, since `web-storefront` calls the public API alone. The first keeps serving `web-admin`, `web-platform`, and the console hosts. All reader traffic then reaches processes of its own, which you scale apart from the consoles, and those processes hold neither console's database login nor the web service credential. [The deployment reference](https://github.com/publira/publira/blob/main/infra/deploy/README.md#long-lived-processes) lists what each of the two reads.
4. **A server for the consoles alone.** The first `publira server` runs `--role admin,platform`, and leaves the public API to the readers' server. `web-admin` calls the public API for the tenant's theme and tags as well as the tenant console's API, so its `PUBLIRA_PUBLIC_GRPC_URL` names the readers' server, while its `PUBLIRA_GRPC_URL` keeps naming the first. The edge sends the console hosts' public API to the readers' server too, which answers it on any host, and keeps their images on the first, since a `--role storefront` process answers a console host's images with `404`. The consoles' server then holds no `publira_public` login and does none of the public API's work, and the readers' server is scaled with the public API's traffic alone.
5. **Copies of each.** Run as many copies of each process as its traffic needs.

The edge can still keep image conversion off the processes that answer the public API. It routes `/images` and `/rpc/publira.v1.` on the tenants' domains by path, so each can go to a group of `--role storefront` processes of its own: one group converts images, and the other answers the API, each with as many copies as its traffic needs. `web-storefront` calls the API group, since it never fetches an image itself, and so does `web-admin` through `PUBLIRA_PUBLIC_GRPC_URL` after step 4. Nothing changes in the processes themselves, only the backend the edge forwards each path to and the URLs the web apps are given. Keep the console hosts' `/images` on the `publira server` `web-admin` calls on `PUBLIRA_GRPC_URL`, since a `--role storefront` process answers a console host's images with `404`, and their `/rpc/publira.v1.` with it until step 4 sends it to the API group.

Kubernetes and ECS have the resources for steps 3 and 4: [Keeping the consoles' credentials off the tenants' domains](./5-kubernetes/2-operating.md#keeping-the-consoles-credentials-off-the-tenants-domains) on Kubernetes, and [the same section](./6-ecs-fargate/2-operating.md#keeping-the-consoles-credentials-off-the-tenants-domains) on ECS.

### Serving the images and the public API apart

The two groups can also sit behind two load balancers rather than one, so that the images, which a CDN in front can cache, and the API's calls, which it cannot, never share a load balancer. Each group is reached on host names of its own:

- **The images** on each tenant's [image host](../3-operations/2-tenants.md#an-image-host), such as `images.comics.example.com`. Every image host points at a load balancer in front of the image group, which terminates TLS for it and forwards `/images` on it, and nothing else, with `Host` unchanged, as [A tenant's image host](./4-edge/index.md#a-tenants-image-host) describes. Once a tenant has an image host, the public API gives its site's images there, so its site and its mobile app load them through that load balancer. A tenant without one keeps its images on its domain, through the edge, so give every tenant one before you rely on the split.
- **The public API** on a host name of its own, such as `api.example.com`, which points at a load balancer in front of the API group and forwards `/rpc/publira.v1.` alone. The public API finds the tenant from the request rather than from the host, so one host serves every tenant, and the process needs no change for it. `web-storefront`'s `PUBLIRA_GRPC_URL`, and `web-admin`'s `PUBLIRA_PUBLIC_GRPC_URL` after step 4, name the group: `https://api.example.com/rpc` when the web apps run outside the group's network, or the group's private address, which skips the load balancer, when they run beside it. A tenant's mobile app is built with `PUBLIRA_BASE_URL=https://api.example.com`, as [The address the app connects to](../5-mobile-app/2-building.md#the-address-the-app-connects-to) describes.

Both load balancers do what [Edge](./4-edge/index.md#what-the-edge-has-to-do) asks of the edge for the paths they forward, and each group's `PUBLIRA_TRUSTED_PROXIES` covers its own load balancer, as [The client address](./4-edge/index.md#the-client-address) describes. Each group runs `--role storefront` with the same variables as the readers' server of step 3. The tenants' domains and console hosts stay on the edge as before, and keep forwarding `/images` and `/rpc/publira.v1.` as before too: the console's images are still loaded on the console host, and an app built before the split still calls the API on the tenant's domain.

An install that keeps one edge can serve the image hosts on it instead, routing them as [A tenant's image host](./4-edge/index.md#a-tenants-image-host) describes; the sample configurations take them in `PUBLIRA_EDGE_IMAGE_HOSTS`. [Serving the images and the public API apart](./5-kubernetes/2-operating.md#serving-the-images-and-the-public-api-apart) has the resources for two load balancers on Kubernetes, and [the same section](./6-ecs-fargate/2-operating.md#serving-the-images-and-the-public-api-apart) on ECS.

## Splitting the worker by queue

The worker keeps its work on four queues: `outbox`, the mail, push notifications, and cache revalidation of the outbox; `ticker`, the jobs that act at a scheduled time; `maintenance`, the rebuilds and purges; and `search_index`, the search index build. A copy given `--queue` takes the work of the queues it names and no other, so the outbox can have copies of its own, sized apart from the one that runs the hour-long rebuilds. When the mail and push notifications of an install have to go out promptly while the rebuilds run, run two processes in place of the one `publira worker`:

```bash
publira worker --queue outbox
publira worker --queue ticker,maintenance,search_index
```

The first sends and revalidates and does nothing else: scale it with the outbox's load, and it signs in to the database as one login rather than three. The second runs every scheduled job, and rarely needs a second copy, since each of its jobs runs on one copy at a time however many there are. On `publira server --with-worker`, the same flag narrows the worker it hosts.

Every queue needs at least one running copy that hosts it. Whichever copy the job queue elects to schedule the jobs schedules all of them, whatever queues it takes itself, so a job whose queue no running copy takes is not lost: it waits in the database, and nothing runs it until a copy that takes its queue starts. Each copy logs the queues it leaves to others when it starts, as `worker leaves queues to other replicas`. Give every copy the same interval variables, since the copy that schedules the jobs schedules them on its own. The [`--queue` reference](https://github.com/publira/publira/blob/main/server/cmd/publira/README.md#hosting-some-queues---queue) lists which database logins and variables each queue brings, and the [deployment reference](https://github.com/publira/publira/blob/main/infra/deploy/README.md#long-lived-processes) lists what each of the two reads.

## The database connection budget

Every copy of `publira server` and `publira worker` opens one pool of connections per database login it signs in as, and each pool holds at most `PUBLIRA_DB_MAX_OPEN_CONNS` connections, ten unless set. The web apps and `email-renderer` open none. The database therefore has to accept:

```text
(the pools of every copy of publira server and publira worker, summed) × PUBLIRA_DB_MAX_OPEN_CONNS
```

| Process | Pools per copy |
| --- | --- |
| `publira server` | 3 |
| `publira server --role <roles>` | 1 per role it is given: 1 for `--role storefront`, 2 for `--role admin,platform` |
| `publira server` serving `storefront` with a replica | 1 more, on the replica rather than the primary |
| `publira server --with-worker` | 6 |
| `publira worker` | 3 |
| `publira worker --queue <queues>` | 1, and 1 more with `ticker`, and 1 more with `maintenance` or `search_index`: 1 for `--queue outbox` |
| `publira worker` hosting `maintenance` with a replica | 1 more, on the replica rather than the primary |
| A `publiractl` command while it runs | 1, and 1 more on the replica for `job aggregate-content-stats` and `job build-recommend-features` given one |

The sum has to fit in the database's `max_connections`, less the connections PostgreSQL keeps for superusers, `superuser_reserved_connections`, three unless set. One server and one worker take 60 of PostgreSQL's default 100. An install with three copies of `publira server --role storefront`, two of `publira server`, and two of `publira worker` takes (3 × 1 + 2 × 3 + 2 × 3) × 10 = 150, which the default no longer accepts.

A request to the public API holds one connection of the public API's pool from start to end, and a request to the tenant console's API one of the console's pool, and one connection of each pool is kept for the queries those requests make outside a tenant. A copy therefore answers at most one less than `PUBLIRA_DB_MAX_OPEN_CONNS` public API requests at once, and as many tenant console requests beside them when it serves both. Raising the bound lets each copy answer more, and adding copies does too; both cost connections at the database. [Connection pools](https://github.com/publira/publira/blob/main/server/README.md#connection-pools) has the full reference.

## Reading from a replica

Two kinds of read grow with an install's readers. The readers' own traffic is almost all reads of the published catalog: the series and episode pages, the lists and searches, and the row read before each of the tenants' images is served. And every view a reader makes is a row of `content_events`, which the worker's daily rebuilds read back, across every tenant, to count the day and to build the recommendations. Both can be made on a hot standby of the database, so that the readers who make up the growth of an install stop adding that load to the primary.

The standby has to be a hot standby of the same cluster, streaming from the primary, such as a read replica of a managed PostgreSQL: the roles, their grants, and their passwords then reach it with everything else, and it is at most a moment behind. A copy restored from a backup, or a database that is not in recovery, is not one. Give it a `max_connections` of its own sized for the replica pools, as [The database connection budget](#the-database-connection-budget) counts them; PostgreSQL also refuses to start a standby with a smaller `max_connections` than the primary's. One standby can serve both kinds of read.

Nothing read on the replica is older than what the primary would have read. Before a read the replica may make, the process reads the primary's position, and the replica makes the read only once it has replayed that far, so every write that had committed by then is in it. A replica still behind after the wait is left out of that read, which the primary makes instead. A replica that falls behind for longer, or is promoted to a primary of its own, therefore sends the reads back to the primary, and the primary's load comes back with them until it catches up. The primary still answers one statement per read the replica takes, the read of its position, which touches no table.

To see the replica taking the reads, turn on [tracing](../3-operations/11-monitoring.md): every query span names the server that answered it in `server.address` and `server.port`, and so does every query metric.

### The readers' catalog reads

Set `PUBLIRA_PUBLIC_DB_REPLICA_URL` on every `publira server` that serves the `storefront` role, the one `--role storefront` process or every process without `--role`, to the standby's connection signed in as `publira_public` with the same password as `PUBLIRA_PUBLIC_DB_URL`. A URL signing in as any other login stops the process at startup. Left unset, which is the default, every read stays on the primary.

What the replica answers:

- The catalog read by a guest: the series, episode, creator, label, genre, and tag pages and lists, the rankings, the recommendations shown to every reader, the related series, the campaign banners, and the sitemap. These are the reads `web-storefront` caches and shares between readers.
- The catalog searches, when the install has no search engine and searches in PostgreSQL.
- The tenants' images, except the pages of an episode, which check what the reader may read.

Everything else `publira server` answers stays on the primary: every request of a signed-in reader, every write, signing in, and the consoles.

A reader waits on each of these requests, so the replica is given 50 milliseconds to catch up. `/readyz` names the replica's pool `db.public.replica`, so a replica that stops answering makes the process not ready, like the primary would.

### The daily rebuilds

Set `PUBLIRA_CONTENT_STATS_DB_REPLICA_URL` on every `publira worker` that hosts the `maintenance` queue, every worker without `--queue` included, to the standby's connection signed in as `publira_content_stats` with the same password as `PUBLIRA_CONTENT_STATS_DB_URL`. `publiractl job aggregate-content-stats` and `publiractl job build-recommend-features` read it too, so set it wherever those are run by hand. A URL signing in as any other login stops the process, or the command, at startup. Left unset, which is the default, every read stays on the primary.

What the replica answers, for each tenant in turn:

- The day the content stats rebuild counts: its views, completed reads, ratings, and favourites from `content_events`, and its purchases and comments.
- The trailing window of a tenant's `content_events`, four weeks unless set, that the recommend feature build reads for each signed-in reader.

Everything else the worker does stays on the primary: every row a rebuild writes, the rankings and the recommendations' per-title figures, which are read from the day's counts the rebuild has just written, the projection of finished reads into `content_events`, every purge, the search index build, and the jobs on the other queues.

Nobody waits on a rebuild, so the replica is given 5 seconds to catch up before a tenant's rebuild reads on the primary instead. A day is not closed to writes when it ends: a finished read projected late is filed on the day the reader finished it, and staff can hide a comment of any day, so the wait is what keeps a rebuild from counting a day without them. `/readyz` names the replica's pool `db.content_stats.replica`.

A rebuild's read on the standby can run for minutes on a large tenant, and PostgreSQL cancels a query on a standby, as `canceling statement due to conflict with recovery`, when replaying the primary's cleanup would remove rows the query still reads. The tenant's rebuild then fails, and the next pass rebuilds the day again from where it stopped. Turn on `hot_standby_feedback` on the standby so the primary keeps those rows until the read ends; the cost is that the primary's cleanup of dead rows, on every table, waits for it.

## What does not scale out

Copies of the processes spread their own work. The services they depend on are each one service to Publira, and making any of them larger, or highly available behind the one address Publira is given, is done in that service:

- **PostgreSQL.** Each pool connects to the one URL its variable names, so every write goes to one primary, and so does every read but the readers' catalog reads and the daily rebuilds' reads of `content_events` a [replica](#reading-from-a-replica) can take. The consoles, the signed-in readers, and the worker's other jobs still reach the primary alone, which makes it where the load of a growing install ends up: more copies of the processes send it more queries, and only a larger primary relieves it.
- **Valkey.** Every process reads one URL.
- **The object store.** The install has one bucket, saved in the platform's settings.
- **The SMTP server.** The worker sends every mail through the SMTP server the settings name.
- **The search engine**, when the install runs one. The install has one, saved in the platform's settings.

## Running several copies day to day

### Stopping a copy

`publira server` and `publira worker` stop within 30 seconds of a `SIGTERM`: they wait up to that long for the requests and jobs in flight to finish, and cut off whatever is still running then. Give the platform a grace period longer than that before it kills the process, such as a `terminationGracePeriodSeconds` of 45 on Kubernetes, where the default is 30, or a `stopTimeout` of 45 seconds in the container definition on ECS, where the default is 30 too. A request cut off at the deadline fails, and its caller sees the connection close. A job cut off is done again: the job queue counts a scheduled job left running as stuck an hour later and runs it again, and each is safe to repeat. An outbox entry left in processing goes back to the queue after `PUBLIRA_OUTBOX_STALE_PROCESSING`, fifteen minutes unless set, and is sent then: delivery is at least once, so an entry whose mail or push notification went out just before the copy was killed is sent a second time.

`publira server` stops accepting connections as soon as it is told to stop, and does not first answer `/readyz` as not ready. The edge therefore has to stop sending a copy requests before the copy is stopped. On ECS it does: the service takes a task out of its Application Load Balancer target group, and waits for the target to drain, before it stops the task. On Kubernetes, a Pod leaves its Service's endpoints at the same time as it is sent `SIGTERM`, so a request may still reach it while that change makes its way to the edge; a `preStop` hook that waits a few seconds, such as one with the `sleep` action, gives the change that time before the process stops accepting connections, which narrows the gap without promising that no request arrives in it. The edge sends a new copy requests once its `/readyz` answers ready, as [Health checks](../3-operations/11-monitoring.md#health-checks) describes.

### Restarting the copies

A change that keeps the release, such as a new value of a variable, can be rolled out one copy at a time, and the install keeps serving while it is. A saved setting needs no restart at all. The release right after the one you run can be rolled out one copy at a time too, the worker included, since the copies of two adjacent releases work side by side and the workers of both share the outbox: [Upgrading](./8-upgrading.md#decide-whether-to-stop-the-processes-first) says how, and what changes when you skip a release.

### Backups

A backup keeps the worker stopped from before the database backup until the bucket copy ends, and that means every copy of it, as [Stop the worker](./9-backup-and-restore.md#1-stop-the-worker) describes. On an install that runs `publira server --with-worker`, that is every copy of that process, and the server stops with it.

## Next steps

[Upgrading](./8-upgrading.md) brings an install with any number of copies to a new release. [Monitoring](../3-operations/11-monitoring.md) has the metrics and the logs to watch the load with.
