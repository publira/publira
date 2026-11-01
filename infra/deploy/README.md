# Deployment

What a Publira install is made of, which environment variables each of its processes reads, and the order an empty install is brought into service in. It describes the minimal install, which runs no Platform Console: one publisher's site and console, operated from [`publiractl`](../../server/cmd/publiractl/README.md). How the parts are hosted — a Compose file, a Helm chart, a set of systemd units — is the operator's choice. [Running it with Docker Compose](#running-it-with-docker-compose) describes the Compose file beside this README, which runs the whole install on one host.

Every release publishes its images as `ghcr.io/publira/<name>:<version>`, built from [`infra/docker/`](../docker/README.md) at the release's tag, the version behind a `v` (`v0.1.0` for `0.1.0`); an install that changes the code builds its own from there. What the edge in front of the processes has to do — a managed load balancer, a reverse proxy, or a CDN in front of one — is stated in [Edge](../../docs/en/2-deployments/4-edge/index.md#what-the-edge-has-to-do); [`infra/proxy/`](../proxy/README.md) holds sample configurations of a reverse proxy that does it.

## What an install runs

### Long-lived processes

| Process | Image | Serves | Reached by |
| --- | --- | --- | --- |
| `web-storefront` | [`infra/docker/web`](../docker/web/Dockerfile) with `APP_NAME=web-storefront` | The public tenant site | The edge, on each tenant's domain |
| `web-admin` | [`infra/docker/web`](../docker/web/Dockerfile) with `APP_NAME=web-admin` | The tenant console | The edge, on each tenant's console host: the one it was given with `--admin-domain`, or `admin.<domain>` without one |
| `publira server` | [`infra/docker/server`](../docker/server/Dockerfile), no container argument | Every Connect namespace under `/rpc`, and image delivery under `/images`, on `:8000` | The edge, on `publira.v1` under `/rpc`, and on `/images`; `web-storefront` and `web-admin`, on `/rpc` |
| `publira worker` | [`infra/docker/server`](../docker/server/Dockerfile), with `worker` as the container argument | The Outbox drain — mail, push, cache revalidation — and every scheduled job | Nothing; it serves `/livez` and `/readyz` on `:8003` |

Every one of them serves `GET /livez` and `GET /readyz` for the orchestrator's probes.

An install on one host that will not scale the Go processes apart may run the two as one instead:

| Process | Image | Serves | Reached by |
| --- | --- | --- | --- |
| `publira server --with-worker` | [`infra/docker/server`](../docker/server/Dockerfile), with `server --with-worker` as the container argument | Everything both processes above serve, on the same two listeners (`:8000`, `:8003`) and the same six database logins | What reaches the two processes above |

It reads the variables of both, so it is given the union of the `publira server` and `publira worker` rows below. What it gives up is the process boundary: the server and the worker can no longer be scaled independently, and the process the edge forwards internet traffic to also holds the worker's logins, `publira_outbox` among them, which owns River's schema. [`publira server --with-worker`](../../server/cmd/publira/README.md#hosting-the-worker---with-worker) has the details. The Compose file beside this README runs this one process. An install runs the two apart when either matters to it: to scale them separately, or to keep the worker's logins out of the process the edge forwards to.

An install that keeps the consoles' APIs and logins out of the process the tenants' domains reach may instead run `publira server` as two processes:

| Process | Image | Serves | Reached by |
| --- | --- | --- | --- |
| `publira server --role storefront` | [`infra/docker/server`](../docker/server/Dockerfile), with `server --role storefront` as the container argument | `publira.v1` under `/rpc`, and the images of every tenant's site, as `publira_public` alone | The edge, on `publira.v1` under `/rpc`, and on `/images`, of each tenant's domain; `web-storefront`, on `/rpc` |
| `publira server` | [`infra/docker/server`](../docker/server/Dockerfile), no container argument | Everything the one `publira server` above serves | `web-admin` and `web-platform`, on `/rpc`; the edge, on `publira.v1` under `/rpc`, and on `/images`, of each console host |

Together they replace the one `publira server` above, and each reads the `publira server` rows below except where a row says otherwise. The storefront process holds neither console's login nor the web service credential. `web-storefront` calls `publira.v1` alone, so its `PUBLIRA_GRPC_URL` names the storefront process. `web-admin` calls `publira.v1` for the tenant's theme and tags as well as `publira.admin.v1`, so with `PUBLIRA_GRPC_URL` alone it calls a process that serves every role. Both listen on `:8000` alone, so either can run on a platform that exposes one port per service. [`--role`](../../server/cmd/publira/README.md#serving-some-roles---role) has the details.

The process behind the consoles can leave out the storefront role as well, once `web-admin` is given a URL of its own for `publira.v1`:

| Process | Image | Serves | Reached by |
| --- | --- | --- | --- |
| `publira server --role storefront` | [`infra/docker/server`](../docker/server/Dockerfile), with `server --role storefront` as the container argument | `publira.v1` under `/rpc`, and the images of every tenant's site, as `publira_public` alone | The edge, on `publira.v1` under `/rpc` of every host, and on `/images` of each tenant's domain; `web-storefront` and `web-admin`, on `/rpc` |
| `publira server --role admin,platform` | [`infra/docker/server`](../docker/server/Dockerfile), with `server --role admin,platform` as the container argument | `publira.admin.v1` and `publira.platform.v1` under `/rpc`, and the images of every console host, as `publira_admin` and `publira_platform` | `web-admin` and `web-platform`, on `/rpc`; the edge, on `/images` of each console host |

`web-admin`'s `PUBLIRA_PUBLIC_GRPC_URL` names the storefront process, and its `PUBLIRA_GRPC_URL` the other. The edge forwards a console host's `publira.v1` to the storefront process, which answers it on any host, and a console host's images to the other, since the images a console page shows are the `admin` role's. The process behind the consoles then holds neither `publira_public` nor any of the public API's work, and the storefront processes are scaled with the public API's traffic alone.

An install whose mail and push notifications have to keep going out while an hour-long rebuild runs may likewise run `publira worker` as two processes:

| Process | Image | Serves | Reached by |
| --- | --- | --- | --- |
| `publira worker --queue outbox` | [`infra/docker/server`](../docker/server/Dockerfile), with `worker --queue outbox` as the container argument | The Outbox drain — mail, push, cache revalidation — as `publira_outbox` alone | Nothing; it serves `/livez` and `/readyz` on `:8003` |
| `publira worker --queue ticker,maintenance,search_index` | [`infra/docker/server`](../docker/server/Dockerfile), with `worker --queue ticker,maintenance,search_index` as the container argument | Every scheduled job, as `publira_outbox`, `publira_ticker`, and `publira_content_stats` | Nothing; it serves `/livez` and `/readyz` on `:8003` |

Together they replace the one `publira worker` above, and each reads the `publira worker` rows below except where a row says otherwise. Every queue needs at least one running process that hosts it: the process River elects leader enqueues every scheduled job, whatever queues it hosts itself, and a job whose queue no process hosts waits until one does. [`--queue`](../../server/cmd/publira/README.md#hosting-some-queues---queue) has the details.

### Services the processes depend on

| Service | Used by | What it holds |
| --- | --- | --- |
| The edge: a load balancer, a reverse proxy, or a CDN in front of one | Browsers and the mobile app | The routing, TLS, and request headers [Edge](../../docs/en/2-deployments/4-edge/index.md#what-the-edge-has-to-do) states. The sample configurations in [`infra/proxy/`](../proxy/README.md) take the install's hosts in `PUBLIRA_EDGE_SITE_HOSTS`, `PUBLIRA_EDGE_ADMIN_HOSTS`, `PUBLIRA_EDGE_PLATFORM_HOSTS`, and `PUBLIRA_EDGE_IMAGE_HOSTS` |
| PostgreSQL | Every process | Everything the install stores |
| Valkey, or any Redis-protocol server | `publira server`, `web-storefront`, `web-admin` | The image conversion cache, the rate limit counters, and the Next.js cache |
| An S3-compatible object store | `publira server`, `publira worker` | Every uploaded image. The bucket is created by the operator, or by `publiractl setup --create-bucket`; `publiractl` saves where it is |
| An SMTP server | `publira worker` | The mail the install sends: reader sign-up, password reset, administrator invitations |

### Commands run by hand

The [`infra/docker/publiractl`](../docker/publiractl/Dockerfile) image carries `publiractl` and the migrations. An install runs it once per release to apply the migrations and the database roles (`db migrate`, `db roles`), once to set the install up (`setup`, which runs the two before its own steps when it is given `PUBLIRA_DB_URL`), and whenever an operator changes a platform setting or runs a maintenance job by hand. Nothing has to run it on a timer: the worker schedules every recurring job.

### Optional processes

| Process | Image | What it adds | What else it needs |
| --- | --- | --- | --- |
| `email-renderer` | [`infra/docker/node`](../docker/node/Dockerfile) with `APP_NAME=email-renderer` | An HTML part in every mail. Without it the worker sends the same mail as `text/plain` | `PUBLIRA_EMAIL_RENDERER_URL` on the worker |
| `web-platform` | [`infra/docker/web`](../docker/web/Dockerfile) with `APP_NAME=web-platform` | The Platform Console: operator accounts, and the tenants, platform settings, dashboard, and audit log in a browser rather than from `publiractl` | Its host routed to it at the edge (`PUBLIRA_EDGE_PLATFORM_HOSTS` and its upstream in the sample configurations), `PUBLIRA_WEB_PLATFORM_INTERNAL_URL` on `publira server` and the worker, `PUBLIRA_PLATFORM_APP_URL` on the worker, and the same `PUBLIRA_GRPC_URL`, `PUBLIRA_AUTH_SECRET`, `PUBLIRA_REVALIDATE_TOKEN`, and `PNCH_*` variables as the other web apps. Its first operator is created on its `/setup` screen |

## Environment variables

What the minimal install sets on each process. Every variable not listed here is optional, and the README of the process that reads it says what it tunes: [`publira server` and `publira worker`](../../server/cmd/publira/README.md), [`publiractl`](../../server/cmd/publiractl/README.md), [`web-storefront`](../../apps/web-storefront/README.md), and [`web-admin`](../../apps/web-admin/README.md).

### Shared values

Each row is one value, set under the name each process reads it by.

| Value | `web-storefront` | `web-admin` | `publira server` | `publira worker` | `publiractl` |
| --- | --- | --- | --- | --- | --- |
| The secret encryption keys | — | — | `PUBLIRA_SECRET_ENCRYPTION_KEYS`, `PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID` | the same | the same |
| The cache revalidation token | `PUBLIRA_REVALIDATE_TOKEN` | `PUBLIRA_REVALIDATE_TOKEN` | `PUBLIRA_REVALIDATE_TOKEN` | `PUBLIRA_REVALIDATE_TOKEN` | — |
| The web service credential, also set on `web-platform` when it runs; not read by `publira server --role storefront` | — | `PUBLIRA_WEB_SERVICE_TOKEN` | `PUBLIRA_WEB_SERVICE_TOKEN` | — | — |
| The Redis URL | `PNCH_REDIS_URL` and `PUBLIRA_REDIS_URL` | `PNCH_REDIS_URL` | `PUBLIRA_REDIS_URL` | — | — |
| The `publira_platform` connection, not read by `publira server --role storefront` | — | — | `PUBLIRA_PLATFORM_DB_URL` | — | `PUBLIRA_PLATFORM_DB_URL` |
| The AWS credential, when the object store is saved without an access key | — | — | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_SESSION_TOKEN` for a temporary credential | the same | the same |

The secret encryption keys seal the SMTP password, the object store's access key, the Web Push private key, and each tenant's payment and push credentials; a process given other keys cannot read what `publiractl` stored. Their format is in [`server/README.md`](../../server/README.md#secret-encryption-configuration-aes-gcm).

### Per process

| Process | Variable | Value |
| --- | --- | --- |
| `web-storefront` | `PUBLIRA_GRPC_URL` | `/rpc` on `publira server`, such as `http://publira-server:8000/rpc`, or on `publira server --role storefront` when the server is split by role |
| `web-admin` | `PUBLIRA_GRPC_URL` | `/rpc` on `publira server`, such as `http://publira-server:8000/rpc`. When the server is split by role, on the process that serves every role, or on `publira server --role admin,platform` once `PUBLIRA_PUBLIC_GRPC_URL` is set |
| `web-admin` | `PUBLIRA_PUBLIC_GRPC_URL` | Unset, which calls `publira.v1` on `PUBLIRA_GRPC_URL` too. Set to `/rpc` on `publira server --role storefront`, such as `http://publira-storefront:8000/rpc`, when `PUBLIRA_GRPC_URL` names `publira server --role admin,platform` |
| `web-storefront`, `web-admin` | `PUBLIRA_AUTH_SECRET` | The key the app seals its session cookie with, at least 32 bytes. The two apps need not share one |
| `publira server` | `PUBLIRA_AUTH_JWT_SECRET` | The key access tokens are signed with, at least 32 bytes |
| `publira server` | `PUBLIRA_PUBLIC_DB_URL`, `PUBLIRA_ADMIN_DB_URL` | The `publira_public` and `publira_admin` connections. A process given `--role` reads only the connection of each role it serves, as the `publira_platform` one is read only with `platform` |
| `publira server` serving the `storefront` role | `PUBLIRA_PUBLIC_DB_REPLICA_URL` | Optional, and unset unless the database has a hot standby: the `publira_public` connection to that standby, which the catalog reads are answered on. [Reading from a replica](../../docs/en/2-deployments/7-scaling-out.md#reading-from-a-replica) has what the standby has to be |
| `publira server`, `publira worker` | `PUBLIRA_WEB_STOREFRONT_INTERNAL_URL`, `PUBLIRA_WEB_ADMIN_INTERNAL_URL` | The private network URLs of `web-storefront` and `web-admin`, such as `http://web-storefront:3000`, where the cache revalidation is sent |
| `publira worker` | `PUBLIRA_WORKER_DB_URL`, `PUBLIRA_TICKER_DB_URL`, `PUBLIRA_CONTENT_STATS_DB_URL` | The `publira_outbox`, `publira_ticker`, and `publira_content_stats` connections. A process given `--queue` reads the `publira_outbox` one and those of the queues it hosts, as the `publira_ticker` one is read only with `ticker` |
| `publira worker` hosting the `maintenance` queue | `PUBLIRA_CONTENT_STATS_DB_REPLICA_URL` | Optional, and unset unless the database has a hot standby: the `publira_content_stats` connection to that standby, which the daily rebuilds read `content_events` on. [The daily rebuilds](../../docs/en/2-deployments/7-scaling-out.md#the-daily-rebuilds) has what it reads there |
| `publiractl` | `PUBLIRA_DB_URL` | The connection of the login that owns the database and may create roles, read by the `db` commands alone. It need not be a superuser |

`publira server --with-worker` reads every row naming `publira server` or `publira worker`, here and under [Shared values](#shared-values).

`PUBLIRA_WEB_PLATFORM_INTERNAL_URL`, `PUBLIRA_PLATFORM_APP_URL`, and `PUBLIRA_EMAIL_RENDERER_URL` are left unset: they name the optional processes. The web images set `PORT`, `HOSTNAME`, and `PNCH_CACHE_APP` themselves.

Every `*_DB_URL` of `publira server` and the worker falls back to a development URL rather than to another variable, so each one is set, with the password its role was given.

Each of those connections is a pool of at most `PUBLIRA_DB_MAX_OPEN_CONNS` connections, `10` unless set, so one server and one worker open up to 60 against the database. Running more of either, or raising the bound, needs a `max_connections` sized for it: [Connection pools](../../server/README.md#connection-pools) has the arithmetic.

## Bringing an install into service

Before the first step, provision the dependency services: a PostgreSQL database with a login that owns it and has `CREATEROLE` — its superuser, or a managed PostgreSQL's administrative login such as Cloud SQL's `postgres` user — which the first two steps connect as through `PUBLIRA_DB_URL`, a Valkey instance, an empty bucket, and an SMTP account. Point the tenant's domain and its console host, `admin.<domain>` or the one `setup` is given with `--admin-domain`, at the edge.

1. **Apply the migrations** with the publiractl image of the release being installed:

   ```bash
   docker run --rm -e PUBLIRA_DB_URL ghcr.io/publira/publiractl:<version> db migrate
   ```

2. **Create the roles** the processes connect as, on the same connection, giving each its password. The flags and what the command applies are in [`publiractl`](../../server/cmd/publiractl/README.md#db):

   ```bash
   docker run --rm -e PUBLIRA_DB_URL -v /run/secrets:/run/secrets:ro ghcr.io/publira/publiractl:<version> db roles \
     --public-password-file /run/secrets/publira-public-db-password \
     --admin-password-file /run/secrets/publira-admin-db-password \
     --platform-password-file /run/secrets/publira-platform-db-password \
     --outbox-password-file /run/secrets/publira-outbox-db-password \
     --ticker-password-file /run/secrets/publira-ticker-db-password \
     --content-stats-password-file /run/secrets/publira-content-stats-db-password
   ```

3. **Start the four processes** with the variables above, each `*_DB_URL` carrying the password its role was given. The worker applies River's own tables when it starts.

4. **Set the install up** with `publiractl setup`, which saves the platform defaults, the object store after a connection test, the SMTP settings, and the tenant, and creates its first administrator. It asks for every value on a terminal; the unattended form, and what each step saves, are in [`publiractl`](../../server/cmd/publiractl/README.md#setup):

   ```bash
   docker run --rm -it \
     -e PUBLIRA_PLATFORM_DB_URL \
     -e PUBLIRA_SECRET_ENCRYPTION_KEYS -e PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID \
     ghcr.io/publira/publiractl:<version> setup
   ```

   Its summary names the tenant site and the tenant console, and prints the administrator's password when it generated one.

5. **Put the edge in front** of `web-storefront`, `web-admin`, and `publira server`, routing the tenant's domain and its console host and terminating TLS for both, as [Edge](../../docs/en/2-deployments/4-edge/index.md#what-the-edge-has-to-do) states; the sample configurations take the two names in `PUBLIRA_EDGE_SITE_HOSTS` and `PUBLIRA_EDGE_ADMIN_HOSTS`. The administrator signs in to the tenant console at the URL the summary names.

On every later release, run `db migrate` and then `db roles` with that release's publiractl image before its processes start. [Upgrading](../../docs/en/2-deployments/8-upgrading.md) is the full procedure, with the backup before it and what to do when a migration fails.

## Running it with Docker Compose

[`compose.yaml`](compose.yaml) runs an install on one host from the images: PostgreSQL, Valkey, RustFS as the object store, Caddy as the reverse proxy, the web apps, `publira server --with-worker` as the `server` service, and `publiractl` as a service that is only ever run by hand. Each process gets the variables in [Environment variables](#environment-variables), under the names given there, and `server` those of both `publira server` and `publira worker`.

The services share two networks. `edge` holds the proxy and what it forwards to: `server` and the web apps. `default` holds every service but the proxy. The proxy therefore reaches neither the database nor Valkey.

| File | What it holds |
| --- | --- |
| [`compose.yaml`](compose.yaml) | The services, and the values each process is given |
| [`.env.example`](.env.example) | Every variable `compose.yaml` reads. [`publiractl env generate`](../../server/cmd/publiractl/README.md#env) copies it to `.env` beside it with every secret generated; a required value left empty stops `docker compose` before anything starts |
| [`Caddyfile`](Caddyfile) | A relative link to the [Caddy sample](../proxy/caddy/Caddyfile), which the proxy runs as it stands. `compose.yaml` gives it the backend addresses, naming the Compose services |

Every release attaches these files and this README to its GitHub Release as `publira-deploy-<version>.tar.gz`, under one directory, `publira-deploy-<version>/`, so an install runs without a checkout. [`scripts/package-deploy.sh`](../../scripts/package-deploy.sh) writes it: the `Caddyfile` as a regular file, and `.env.example` with `PUBLIRA_IMAGE_TAG` set to the version.

The images are `${PUBLIRA_IMAGE_REGISTRY}/<name>:${PUBLIRA_IMAGE_TAG}`, where `<name>` is `publira`, `publiractl`, `web-storefront`, `web-admin`, `web-platform`, or `email-renderer`. `.env.example` sets the registry to `ghcr.io/publira`, where every release publishes them, and leaves the tag to be set to the release the checkout is at, which the release archive sets already; images built from changed code take their own registry and tag, and `task docker:verify:full` builds them all as `publira/<name>:local`. The edge publishes `PUBLIRA_EDGE_HTTP_PORT` and `PUBLIRA_EDGE_HTTPS_PORT`, `80` and `443` in `.env.example`, on every interface of the host, and routes the hosts in `PUBLIRA_EDGE_SITE_HOSTS`, `PUBLIRA_EDGE_ADMIN_HOSTS`, `PUBLIRA_EDGE_PLATFORM_HOSTS`, and `PUBLIRA_EDGE_IMAGE_HOSTS` and no others, the last of them on `/images` alone. With `PUBLIRA_EDGE_ACME_EMAIL` set, it terminates TLS: it obtains a certificate for every listed host over ACME, registering the account with that address, renews it, keeps it in the `caddy-data` volume, serves HTTPS, and redirects plain HTTP there. Empty, it serves plain HTTP alone. `PUBLIRA_EDGE_TRUSTED_PROXIES` lists, separated by spaces, the addresses or CIDR ranges of a CDN or a load balancer in front, which the edge trusts to name the client address in `X-Forwarded-For`. Empty, it trusts none, and records every request with the address that connected to it. `PUBLIRA_TENANT_URL_SCHEME` is the scheme of tenant links. Empty means https.

The optional processes run when `COMPOSE_PROFILES` names them — `web-platform`, `email-renderer`, or both, comma-separated — together with the variables `.env.example` lists under each.

`PUBLIRA_LOG_FORMAT` and `PUBLIRA_LOG_LEVEL` reach `server` and `publiractl` under the same names, and choose the log's format and its lowest level as [Logs](../../docs/en/3-operations/11-monitoring.md#logs) describes; empty, both keep their defaults.

OpenTelemetry export is off unless `.env` turns it on: `PUBLIRA_TRACING_ENABLED`, `PUBLIRA_DEPLOYMENT_ENVIRONMENT`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_PROTOCOL`, `OTEL_TRACES_SAMPLER`, and `OTEL_TRACES_SAMPLER_ARG` reach `server` and the web apps under the same names, and `PUBLIRA_METRICS_ENABLED`, `OTEL_METRICS_EXPORTER`, and `OTEL_EXPORTER_PROMETHEUS_HOST` reach `server` alone. An empty value is passed as empty, which every process reads as unset. What each one does is in [`server/README.md`](../../server/README.md#distributed-tracing-opentelemetry) and [`packages/tracing`](../../packages/tracing/README.md).

From the directory the release archive extracts to, or `infra/deploy/` in a checkout, an empty install is brought into service with:

```bash
# .env, with every secret generated, written by the publiractl image as the
# host user. docker compose cannot run it, since it refuses to start without
# the .env it is about to write.
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD":/work -w /work \
  ghcr.io/publira/publiractl:<version> env generate
# Then set PUBLIRA_EDGE_SITE_HOSTS, PUBLIRA_EDGE_ADMIN_HOSTS, and
# PUBLIRA_EDGE_ACME_EMAIL in .env, and PUBLIRA_IMAGE_TAG in a checkout.

docker compose run --rm setup
docker compose up -d
```

The `setup` service is `publiractl setup` with what the Compose file already holds given as flags: each role's password from `.env`, mounted in `/run/secrets/`, and the RustFS bucket `publira`, its endpoint, and the RustFS credential, with `--create-bucket`. With `PUBLIRA_DB_URL` set to the superuser's connection it applies the migrations and creates the roles first, then creates the bucket, and asks for the rest on the terminal. A flag given after `setup` is added to them, such as `--non-interactive` and the values it would ask for. Run again, it changes nothing that is set up already. The `publiractl` service carries the same values for every other command.

On every later release, extract its archive beside the current one, copy `.env` into it, and run the rest from there, or check out its tag; set `PUBLIRA_IMAGE_TAG` to its version, the tag without the `v`, then run `docker compose pull` followed by `docker compose pull publiractl`, which the first leaves out since it sits in a profile of its own, then `db migrate`, `db roles` with no flags, and `docker compose up -d --remove-orphans`, which also removes the container of a service the release dropped. The fixed project name is what lets the new directory run the same containers and volumes. A checkout also runs `docker compose restart proxy`, since the proxy mounts the Caddyfile as a single file that the checkout replaces at the same path. [Upgrading](../../docs/en/2-deployments/8-upgrading.md#on-the-docker-compose-install) is the full procedure.

The install's state is the two volumes, `postgres-data` and `rustfs-data`, and the encryption keys in `.env`; Valkey keeps nothing, and the certificates in `caddy-data` are obtained again when it is empty. [Backup and restore](../../docs/en/2-deployments/9-backup-and-restore.md#on-the-docker-compose-install) backs them up and brings them back on an empty host.

`task deploy:check` renders the file with every profile and checks that `.env.example` lists exactly what it reads, that the ACME contact hands the proxy every listed host to serve over HTTPS and none without it, that the `.env` `publiractl env generate` writes from it renders once the image tag and the hosts are filled in, with no secret left empty, and that the release archive, extracted away from the checkout, renders and holds as regular files every file the Compose file names on the host. `task deploy:smoke` extracts the release archive the same way and takes it, with the images `task docker:verify:full` built, through the steps above, under a project name of its own and with the ACME contact left empty, since no certificate authority reaches its `.localhost` hosts, runs `setup` a second time to check that it changes nothing, and checks that the tenant site, the tenant console, and the Platform Console answer through the edge, that `server` is the one container of the publira image and answers the readiness of both processes and drains the Outbox, that the proxy reaches `server` and the web apps and not the database or Valkey, and that image delivery resizes and converts an image through libvips.
