# Deployment

What a Publira install is made of, which environment variables each of its processes reads, and the order an empty install is brought into service in. It describes the minimal install, which runs no Platform Console: one publisher's site and console, operated from [`publiractl`](../../server/cmd/publiractl/README.md). How the parts are hosted — a Compose file, a Helm chart, a set of systemd units — is the operator's choice. [Running it with Docker Compose](#running-it-with-docker-compose) describes the Compose file beside this README, which runs the whole install on one host.

The images are built from [`infra/docker/`](../docker/README.md), and the reverse proxy is configured from [`infra/proxy/`](../proxy/README.md).

## What an install runs

### Long-lived processes

| Process | Image | Serves | Reached by |
| --- | --- | --- | --- |
| `web-host` | [`infra/docker/web`](../docker/web/Dockerfile) with `APP_NAME=web-host` | The public tenant site | The reverse proxy, on every host that is not a console host |
| `web-admin` | [`infra/docker/web`](../docker/web/Dockerfile) with `APP_NAME=web-admin` | The tenant console | The reverse proxy, on each tenant's console host: the one it was given with `--admin-domain`, or `admin.<domain>` without one. The proxy examples route `admin\d*.` hosts, so a deployment whose tenants use another console host routes that host to `web-admin` as well |
| `publira server` | [`infra/docker/server`](../docker/server/Dockerfile), no container argument | The public API and image delivery on its edge listener (`:8000`), and every Connect namespace on its internal listener (`:8100`) | The reverse proxy, on `/api` and `/images`; `web-host` and `web-admin`, on the internal listener |
| `publira worker` | [`infra/docker/server`](../docker/server/Dockerfile), with `worker` as the container argument | The Outbox drain — mail, push, cache revalidation — and every scheduled job | Nothing; it serves `/livez` and `/readyz` on `:8003` |

Every one of them serves `GET /livez` and `GET /readyz` for the orchestrator's probes.

### Services the processes depend on

| Service | Used by | What it holds |
| --- | --- | --- |
| A reverse proxy | Browsers and the mobile app | The routing in [`infra/proxy/README.md`](../proxy/README.md), from one of the sample configurations there adapted to the install's hosts |
| PostgreSQL | Every process | Everything the install stores |
| Valkey, or any Redis-protocol server | `publira server`, `web-host`, `web-admin` | The image conversion cache, the rate limit counters, and the Next.js cache |
| An S3-compatible object store | `publira server`, `publira worker` | Every uploaded image. The bucket is created by the operator; `publiractl` saves where it is |
| An SMTP server | `publira worker` | The mail the install sends: reader sign-up, password reset, administrator invitations |

### Commands run by hand

The [`infra/docker/publiractl`](../docker/publiractl/Dockerfile) image carries `publiractl` and the migrations. An install runs it once per release to apply the migrations and the database roles (`db migrate`, `db roles`), once to set the install up (`setup`), and whenever an operator changes a platform setting or runs a maintenance job by hand. Nothing has to run it on a timer: the worker schedules every recurring job.

### Optional processes

| Process | Image | What it adds | What else it needs |
| --- | --- | --- | --- |
| `email-renderer` | [`infra/docker/node`](../docker/node/Dockerfile) with `APP_NAME=email-renderer` | An HTML part in every mail. Without it the worker sends the same mail as `text/plain` | `PUBLIRA_EMAIL_RENDERER_URL` on the worker |
| `web-platform` | [`infra/docker/web`](../docker/web/Dockerfile) with `APP_NAME=web-platform` | The Platform Console: operator accounts, and the tenants, platform settings, dashboard, and audit log in a browser rather than from `publiractl` | The `platform.` host rule and its upstream on the reverse proxy, `PUBLIRA_WEB_PLATFORM_INTERNAL_URL` on `publira server` and the worker, `PUBLIRA_PLATFORM_APP_URL` on the worker, and the same `PUBLIRA_GRPC_URL`, `PUBLIRA_AUTH_SECRET`, and `PNCH_*` variables as the other web apps. Its first operator is created on its `/setup` screen |

## Environment variables

What the minimal install sets on each process. Every variable not listed here is optional, and the README of the process that reads it says what it tunes: [`publira server` and `publira worker`](../../server/cmd/publira/README.md), [`publiractl`](../../server/cmd/publiractl/README.md), [`web-host`](../../apps/web-host/README.md), and [`web-admin`](../../apps/web-admin/README.md).

### Shared values

Each row is one value, set under the name each process reads it by.

| Value | `web-host` | `web-admin` | `publira server` | `publira worker` | `publiractl` |
| --- | --- | --- | --- | --- | --- |
| The secret encryption keys | — | — | `PUBLIRA_SECRET_ENCRYPTION_KEYS`, `PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID` | the same | the same |
| The cache revalidation token | `PNCH_REVALIDATE_TOKEN` | `PNCH_REVALIDATE_TOKEN` | `PUBLIRA_REVALIDATE_TOKEN` | `PUBLIRA_REVALIDATE_TOKEN` | — |
| The Redis URL | `PNCH_REDIS_URL` | `PNCH_REDIS_URL` | `PUBLIRA_REDIS_URL` | — | — |
| The `publira_platform` connection | — | — | `PUBLIRA_PLATFORM_DB_URL` | — | `PUBLIRA_PLATFORM_DB_URL` |
| The AWS credential, when the object store is saved without an access key | — | — | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_SESSION_TOKEN` for a temporary credential | the same | the same |

The secret encryption keys seal the SMTP password, the object store's access key, the Web Push private key, and each tenant's payment and push credentials; a process given other keys cannot read what `publiractl` stored. Their format is in [`server/README.md`](../../server/README.md#secret-encryption-configuration-aes-gcm).

### Per process

| Process | Variable | Value |
| --- | --- | --- |
| `web-host`, `web-admin` | `PUBLIRA_GRPC_URL` | The internal listener of `publira server`, such as `http://publira-server:8100` |
| `web-host`, `web-admin` | `PUBLIRA_AUTH_SECRET` | The key the app seals its session cookie with, at least 32 bytes. The two apps need not share one |
| `publira server` | `PUBLIRA_AUTH_JWT_SECRET` | The key access tokens are signed with, at least 32 bytes |
| `publira server` | `PUBLIRA_PUBLIC_DB_URL`, `PUBLIRA_ADMIN_DB_URL` | The `publira_public` and `publira_admin` connections |
| `publira server`, `publira worker` | `PUBLIRA_WEB_HOST_INTERNAL_URL`, `PUBLIRA_WEB_ADMIN_INTERNAL_URL` | The private network URLs of `web-host` and `web-admin`, such as `http://web-host:3000`, where the cache revalidation is sent |
| `publira worker` | `PUBLIRA_WORKER_DB_URL`, `PUBLIRA_TICKER_DB_URL`, `PUBLIRA_CONTENT_STATS_DB_URL` | The `publira_outbox`, `publira_ticker`, and `publira_content_stats` connections |
| `publiractl` | `PUBLIRA_DB_URL` | The superuser connection, read by `db migrate` and `db roles` alone |

`PUBLIRA_WEB_PLATFORM_INTERNAL_URL`, `PUBLIRA_PLATFORM_APP_URL`, and `PUBLIRA_EMAIL_RENDERER_URL` are left unset: they name the optional processes. The web images set `PORT`, `HOSTNAME`, and `PNCH_CACHE_APP` themselves.

Every `*_DB_URL` of `publira server` and the worker falls back to a development URL rather than to another variable, so each one is set, with the password its role was given.

## Bringing an install into service

Before the first step, provision the dependency services: a PostgreSQL database with a superuser login, which the first two steps connect as through `PUBLIRA_DB_URL`, a Valkey instance, an empty bucket, and an SMTP account. Point the tenant's domain and `admin.<domain>` at the reverse proxy.

1. **Apply the migrations** with the publiractl image of the release being installed:

   ```bash
   docker run --rm -e PUBLIRA_DB_URL publira/publiractl:local db migrate
   ```

2. **Create the roles** the processes connect as, on the same connection, giving each its password. The flags and what the command applies are in [`publiractl`](../../server/cmd/publiractl/README.md#db):

   ```bash
   docker run --rm -e PUBLIRA_DB_URL -v /run/secrets:/run/secrets:ro publira/publiractl:local db roles \
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
     publira/publiractl:local setup
   ```

   Its summary names the tenant site and the tenant console, and prints the administrator's password when it generated one.

5. **Put the reverse proxy in front** of `web-host`, `web-admin`, and the edge listener of `publira server`, with TLS for both host names. The administrator signs in to the tenant console at `https://admin.<domain>`.

On every later release, run `db migrate` and then `db roles` with that release's publiractl image before its processes start.

## Running it with Docker Compose

[`compose.yaml`](compose.yaml) runs an install on one host from the images: PostgreSQL, Valkey, RustFS as the object store, Traefik as the reverse proxy, the four long-lived processes, and `publiractl` as a service that is only ever run by hand. Each process gets the variables in [Environment variables](#environment-variables), under the names given there.

| File | What it holds |
| --- | --- |
| [`compose.yaml`](compose.yaml) | The services, and the values each process is given |
| [`.env.example`](.env.example) | Every variable `compose.yaml` reads. Copy it to `.env` beside it and fill in every empty value; a required one left empty stops `docker compose` before anything starts |
| [`services.yaml`](services.yaml) | Traefik's backend addresses, naming the Compose services. The routing is [`routes.yaml`](../proxy/traefik/dynamic/routes.yaml), mounted as it stands |

The images are `${PUBLIRA_IMAGE_REGISTRY}/<name>:${PUBLIRA_IMAGE_TAG}`, where `<name>` is `publira`, `publiractl`, `web-host`, `web-admin`, `web-platform`, or `email-renderer`; `task docker:verify:full` builds them all as `publira/<name>:local`. The edge publishes plain HTTP on `127.0.0.1:${PUBLIRA_EDGE_PORT}`, which whatever terminates TLS on the host forwards to. `PUBLIRA_TENANT_URL_SCHEME` is the scheme of tenant links. Empty means https.

The optional processes run when `COMPOSE_PROFILES` names them — `web-platform`, `email-renderer`, or both, comma-separated — together with the variables `.env.example` lists under each.

From `infra/deploy/`, an empty install is brought into service with:

```bash
docker compose run --rm publiractl db migrate
docker compose run --rm publiractl db roles \
  --public-password-file /run/secrets/public-db-password \
  --admin-password-file /run/secrets/admin-db-password \
  --platform-password-file /run/secrets/platform-db-password \
  --outbox-password-file /run/secrets/outbox-db-password \
  --ticker-password-file /run/secrets/ticker-db-password \
  --content-stats-password-file /run/secrets/content-stats-db-password
docker compose up -d

# The bucket, created in RustFS with its own credential.
docker compose exec rustfs sh -c \
  'curl -fsS -X PUT --aws-sigv4 aws:amz:us-east-1:s3 --user "$RUSTFS_ACCESS_KEY:$RUSTFS_SECRET_KEY" http://localhost:9000/publira'

docker compose run --rm publiractl setup \
  --bucket publira --region us-east-1 --endpoint http://rustfs:9000 --force-path-style \
  --access-key-id <PUBLIRA_RUSTFS_ACCESS_KEY> --secret-access-key-file /run/secrets/rustfs-secret-key
```

The `publiractl` service carries each role's password from `.env` in `/run/secrets/`, and the RustFS secret key as `rustfs-secret-key`. `setup` asks for the rest on the terminal.

On every later release, set `PUBLIRA_IMAGE_TAG`, then run `docker compose pull`, `db migrate`, `db roles` with no flags, and `docker compose up -d`.

`task deploy:check` renders the file with every profile and checks that `.env.example` lists exactly what it reads. `task deploy:smoke` takes the images `task docker:verify:full` built through the steps above, under a project name of its own, and checks that the tenant site, the tenant console, and the Platform Console answer through the edge.
