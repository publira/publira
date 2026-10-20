---
title: Docker Compose
description: Run a whole install on one host with the Compose file in the repository, from generating its .env to the first sign-in to the tenant console.
published: 2026-10-06
updated: 2026-10-19
---

The repository ships a Compose file that runs a whole install on one host: the services Publira depends on, the processes of an install, and a reverse proxy in front of them, already wired together. It is the shortest way to a working install, and this page takes you from an empty host to the first sign-in to the tenant console.

The Compose file runs the same steps as [Installing](./2-installing.md), which explains why each step exists, what every secret protects, and what each database role can reach. This page covers what is particular to the Compose file: what it runs, what you set in it, and the commands that bring it up. The full list of variables it reads is in the [deployment reference](https://github.com/publira/publira/blob/main/infra/deploy/README.md#running-it-with-docker-compose).

## What the file runs

[`infra/deploy/compose.yaml`](https://github.com/publira/publira/blob/main/infra/deploy/compose.yaml) defines these services:

| Service | What it is | What it keeps on the host |
| --- | --- | --- |
| `postgres` | PostgreSQL, holding everything the install stores | The `postgres-data` volume |
| `valkey` | Valkey, holding the image conversion cache, the rate limit counters, and the web apps' cache | Nothing; it starts empty after every restart |
| `rustfs` | [RustFS](https://github.com/rustfs/rustfs), an S3-compatible object store, holding every uploaded image | The `rustfs-data` volume |
| `proxy` | Caddy, the reverse proxy, with the repository's own routing, which obtains and renews the certificates of your host names | The `caddy-data` volume, holding the certificates |
| `server` | `publira server` and `publira worker` as one process, `publira server --with-worker`, which the [Overview](./1-overview.md#what-an-install-runs) describes | Nothing |
| `web-storefront`, `web-admin` | The public site and the tenant console | Nothing |
| `web-platform`, `email-renderer` | The optional processes, which run only when you turn them on | Nothing |
| `publiractl` | The command-line tool, never kept running: you run it with `docker compose run --rm publiractl <command>` | Nothing |
| `setup` | `publiractl setup` with the install's database passwords and its RustFS bucket already given, never kept running: you run it with `docker compose run --rm setup` | Nothing |

The server and the worker run as one process, so the host runs one container fewer. Run them as two instead when either matters to your install: to scale them separately, or to keep the worker's database logins out of the process the proxy forwards to. The [deployment reference](https://github.com/publira/publira/blob/main/infra/deploy/README.md#environment-variables) lists the variables each of the two reads.

The proxy publishes ports 80 and 443 on every interface of the host, and is the one service the internet reaches: it serves HTTPS for the host names you list, and redirects plain HTTP there. Every other service is reachable only from the others.

The services are on two Docker networks. `edge` holds the proxy and what it forwards to: `server` and the web apps. `default` holds every service but the proxy. The proxy therefore reaches neither the database nor Valkey, and a flaw in it is not a way into either.

The project name is fixed as `publira-deploy`, so the volumes keep their names across every command you run, and one host runs one install.

## Before you start

You need:

- **A host with Docker Engine and the Compose plugin**, `docker compose`, on `linux/amd64` or `linux/arm64`, the two platforms the images are published for. On any other, the first pull fails with `no matching manifest`, and the host runs images built for it instead, as [The images](#the-images) describes.
- **A checkout of the repository at the release you install**, such as a clone checked out at that release's tag, such as `v0.1.0`. The Compose file is not self-contained: the proxy's `Caddyfile` beside it is a link into `infra/proxy/`, so keep the whole checkout rather than copying `infra/deploy/` out of it. Every command on this page runs from `infra/deploy/`.
- **Access from the host to `ghcr.io`**, where every release publishes its images. `docker compose` pulls them the first time a command needs them, without signing in, so nothing is built on the host.
- **An SMTP server**, which `publiractl setup` asks for: its host, port, encryption, and the address mail is sent from, and the user name and password to sign in with, unless it relays without credentials.
- **DNS** for the tenant's domain and for `admin.<domain>`, both pointing at the host.
- **Ports 80 and 443 open to the internet**, and nothing else on the host listening on either. The proxy answers on both, and the certificate authority checks each host name on one of them before it issues a certificate for it.

## Write `.env`

Every value the file needs comes from a `.env` file beside it. `publiractl env generate` writes it from `.env.example`, which lists every variable the file reads with a comment on each, and fills in every secret with a value of its own. Run it with the `publiractl` image of the release you install, with `<version>` the release's version as [The images](#the-images) describes:

```bash
cd infra/deploy
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD":/work -w /work \
  ghcr.io/publira/publiractl:<version> env generate
```

It prints `Wrote .env with 17 secrets generated.` and nothing else. The image runs as your user, so the file is yours, and it is created readable by you alone. It refuses to write over an existing `.env`, which may hold the keys an install's data is sealed with. `docker compose run` cannot run this step, since it stops while `.env` is missing the values the next three sections set.

`.env` holds every secret of the install, the encryption keys among them, so keep a copy of it somewhere other than the host.

Four values are left for you to set in it: `PUBLIRA_IMAGE_TAG`, the two host lists, `PUBLIRA_EDGE_SITE_HOSTS` and `PUBLIRA_EDGE_ADMIN_HOSTS`, and `PUBLIRA_EDGE_ACME_EMAIL`, which turns HTTPS on.

### The images

`PUBLIRA_IMAGE_REGISTRY` and `PUBLIRA_IMAGE_TAG` name the images, as `<registry>/<name>:<tag>`. The example's registry, `ghcr.io/publira`, is where every release publishes them; keep it. Set the tag to the version of the release your checkout is at, which is its Git tag without the `v`, such as `0.1.0` for a checkout at `v0.1.0`:

```text
PUBLIRA_IMAGE_TAG=0.1.0
```

Every image runs that one tag, and it has to match the checkout: `publiractl` carries the migrations of its release, the processes expect the schema of theirs, and the proxy runs the routing of the checkout.

If you change the code, or the host is on neither `linux/amd64` nor `linux/arm64`, build the images yourself from the [image build instructions](https://github.com/publira/publira/blob/main/infra/docker/README.md) instead, and set both variables to where they are: the address of the registry you push them to, such as `registry.example.com/publira`, and your own tag, or `publira` and `local` for the images `task docker:verify:full` builds on the host itself.

### HTTPS and the tenant URL scheme

`PUBLIRA_EDGE_ACME_EMAIL` turns HTTPS on. Set it to an address of yours, which the proxy registers its account at the certificate authority with:

```text
PUBLIRA_EDGE_ACME_EMAIL=ops@example.com
```

The proxy then obtains a certificate for every host name in the host lists from [Let's Encrypt](https://letsencrypt.org/), or from ZeroSSL when Let's Encrypt fails, renews each one before it expires, serves HTTPS on port 443, and redirects plain HTTP on port 80 there. Left empty, the proxy serves plain HTTP alone, which only [Trying it on one machine](#trying-it-on-one-machine) and [A CDN or a load balancer in front](#a-cdn-or-a-load-balancer-in-front) call for.

`PUBLIRA_EDGE_HTTP_PORT` and `PUBLIRA_EDGE_HTTPS_PORT` are the ports the proxy publishes, `80` and `443`. Keep them while it obtains the certificates: the certificate authority reaches it on those ports and no others.

Leave `PUBLIRA_TENANT_URL_SCHEME` empty when browsers reach the install over HTTPS. It is the scheme of the links Publira builds, in mail and in the `setup` summary. Set it to `http` only when browsers really open the install over HTTP, as in [Trying it on one machine](#trying-it-on-one-machine).

### The host names

`PUBLIRA_EDGE_SITE_HOSTS` and `PUBLIRA_EDGE_ADMIN_HOSTS` are the host names the proxy routes to the tenant site and to the tenant console: the tenant's domain, such as `comics.example.com`, and its console host, `admin.comics.example.com` unless you will give it another with `--admin-domain`. Write the names without a port. Each variable takes several names separated by spaces, one per tenant, and the proxy answers any host in neither with a 404 of its own.

```text
PUBLIRA_EDGE_SITE_HOSTS=comics.example.com
PUBLIRA_EDGE_ADMIN_HOSTS=admin.comics.example.com
```

`PUBLIRA_EDGE_PLATFORM_HOSTS` is the Platform Console's, and stays empty unless you run it.

### The secrets

`env generate` filled these in, each with a fresh value no other install shares:

| Variable | What it generated |
| --- | --- |
| `PUBLIRA_POSTGRES_PASSWORD` | 32 random bytes as hex |
| `PUBLIRA_PUBLIC_DB_PASSWORD`, `PUBLIRA_ADMIN_DB_PASSWORD`, `PUBLIRA_PLATFORM_DB_PASSWORD`, `PUBLIRA_OUTBOX_DB_PASSWORD`, `PUBLIRA_TICKER_DB_PASSWORD`, `PUBLIRA_CONTENT_STATS_DB_PASSWORD` | 32 random bytes as hex, one each |
| `PUBLIRA_SECRET_ENCRYPTION_KEYS` | `k1:` and 32 random bytes as base64 |
| `PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID` | `k1`, the ID in front of the key above |
| `PUBLIRA_AUTH_JWT_SECRET`, `PUBLIRA_WEB_STOREFRONT_AUTH_SECRET`, `PUBLIRA_WEB_ADMIN_AUTH_SECRET`, `PUBLIRA_WEB_PLATFORM_AUTH_SECRET`, `PUBLIRA_WEB_SERVICE_TOKEN` | 32 random bytes as base64, one each |
| `PUBLIRA_REVALIDATE_TOKEN` | 32 random bytes as hex |
| `PUBLIRA_RUSTFS_ACCESS_KEY`, `PUBLIRA_RUSTFS_SECRET_KEY` | 32 random bytes as hex, one each |

Leave them as they are. The database passwords go into connection URLs unescaped, which is why they are hex; a value you set by hand instead has to keep to URL-safe characters too. The first one is the PostgreSQL superuser's, which only `publiractl setup` and the `publiractl db` commands connect as; the other six are the passwords `setup` gives the roles the processes connect as. The two RustFS values are the object store's own credential: RustFS starts with it, and `setup` saves it as the credential Publira reaches the bucket with. What the rest protect is in [Generate the secrets](./2-installing.md#generate-the-secrets).

### What stops `docker compose`

The three values you set are required, and so is every secret but `PUBLIRA_WEB_PLATFORM_AUTH_SECRET`. While one of them is empty, every `docker compose` command, `run` included, stops before it starts anything and names each variable missing, once for every service that reads it:

```text
error while interpolating services.email-renderer.image: required variable PUBLIRA_IMAGE_TAG is missing a value
error while interpolating services.proxy.environment.PUBLIRA_EDGE_ADMIN_HOSTS: required variable PUBLIRA_EDGE_ADMIN_HOSTS is missing a value
```

`PUBLIRA_EDGE_ACME_EMAIL` does not stop `docker compose` while it is empty: the proxy serves plain HTTP instead. The rest of the file may stay empty too: `PUBLIRA_TENANT_URL_SCHEME`, `COMPOSE_PROFILES`, `PUBLIRA_EDGE_PLATFORM_HOSTS`, `PUBLIRA_EDGE_TRUSTED_PROXIES`, which only [A CDN or a load balancer in front](#a-cdn-or-a-load-balancer-in-front) fills in, and the variables of the optional processes, which the next section fills in when you turn one on.

A variable exported in the shell you run `docker compose` from takes precedence over the same variable in `.env`. If a value you wrote in `.env` seems to be ignored, look for a `PUBLIRA_*` variable in your shell's environment.

## Choose the optional processes

The optional processes run when `COMPOSE_PROFILES` names them, as a comma-separated list. Each one also needs the variables listed under it in `.env`:

| Profile | What it adds | What else to set in `.env` |
| --- | --- | --- |
| `email-renderer` | An HTML part in every mail | `PUBLIRA_EMAIL_RENDERER_URL=http://email-renderer:8080` |
| `web-platform` | The Platform Console | `PUBLIRA_WEB_PLATFORM_INTERNAL_URL=http://web-platform:4100`, `PUBLIRA_PLATFORM_APP_URL` set to the address operators open it at, such as `https://platform.example.com`, and `PUBLIRA_EDGE_PLATFORM_HOSTS` set to the host name in that address, such as `platform.example.com`. `env generate` already filled in its session key, `PUBLIRA_WEB_PLATFORM_AUTH_SECRET` |

For example, to run both:

```text
COMPOSE_PROFILES=web-platform,email-renderer
```

`docker compose` does not stop on an empty `PUBLIRA_WEB_PLATFORM_AUTH_SECRET`, since it only matters when the profile runs, but no operator can sign in to the Platform Console without it, so keep the value `env generate` wrote. Its host name also needs DNS pointing at the host, and the proxy obtains its certificate with the others.

You can choose these now or later. To turn one on in an install that is already running, add it to `COMPOSE_PROFILES`, set its variables, and run `docker compose up -d` again: it starts the new process and restarts the ones whose variables changed. What each process does once it runs is in [Turning on the optional processes](./2-installing.md#turning-on-the-optional-processes).

## Bring the install up

Run each step from `infra/deploy/`, in this order.

### 1. Set the install up

```bash
docker compose run --rm setup
```

The first command pulls the images it needs, starts PostgreSQL and RustFS, and waits until both answer. `setup` then brings the install from an empty database to a tenant an administrator signs in to, one step after the other, and prints each step as it finishes:

1. It applies the migrations and creates the six database roles, with the passwords from `.env`, which the Compose file hands it as files so they never appear on a command line.
2. It creates the bucket, named `publira`, in RustFS, and saves it with the RustFS credential from `.env` once a test of it has passed.
3. It asks on the terminal for everything else: the platform's default locale, time zone, and currency, the SMTP settings, whether to set up Web Push, the tenant's name and domain, and its first administrator. [Set the install up](./2-installing.md#4-set-the-install-up) describes each step.

When it asks for the tenant site domain, give the domain you listed in `PUBLIRA_EDGE_SITE_HOSTS`, such as `comics.example.com`. The console host defaults to `admin.<domain>`, the name you listed in `PUBLIRA_EDGE_ADMIN_HOSTS`.

The summary at the end names the tenant site and the tenant console, and prints the administrator's password when `setup` generated one. That is the only place it appears, so keep it before you close the terminal.

If the run stops halfway, because the SMTP server refused the test message or you pressed Ctrl+C, run the same command again: it keeps every step that finished and asks only for the rest. Run on a finished install, it changes nothing.

### 2. Start the install

```bash
docker compose up -d
docker compose ps
```

`docker compose ps` lists every service of the install as running; `publiractl` and `setup` are not among them, since they only ever run for one command. A process that keeps restarting says why in `docker compose logs <service>`.

The proxy requests the certificates as it starts, and `docker compose logs proxy` prints `certificate obtained successfully` once for each host name. A name it could not get one for is logged as `could not get certificate from issuer`, with the certificate authority's reason, most often DNS that does not point at the host yet or a port closed to the internet. The proxy keeps retrying on its own, so fixing the cause is enough.

### 3. Sign in

Open the tenant console URL the `setup` summary printed, `https://admin.<domain>`, and sign in with the administrator's email address and password. The tenant console opens on the tenant `setup` created, and the tenant's public site answers at `https://<domain>`.

If you turned on the Platform Console, open `PUBLIRA_PLATFORM_APP_URL` and create its first operator on the setup screen. Its accounts are separate from the tenant administrator's.

## Trying it on one machine

To try the install on your own computer, without DNS or certificates, use host names under `.localhost`. Chromium-based browsers and Firefox send every `.localhost` name to the machine itself, and treat it as secure even over plain HTTP, so they keep the session cookie that signing in sets. Over plain HTTP on any other host name, the sign-in seems to succeed, but the next page you open returns you to the sign-in screen.

1. Set `PUBLIRA_TENANT_URL_SCHEME=http` in `.env`, and list the `.localhost` names: `PUBLIRA_EDGE_SITE_HOSTS=comics.localhost` and `PUBLIRA_EDGE_ADMIN_HOSTS=admin.comics.localhost`, plus `PUBLIRA_EDGE_PLATFORM_HOSTS=platform.localhost` if you run the Platform Console. Leave `PUBLIRA_EDGE_ACME_EMAIL` empty: no certificate authority reaches a `.localhost` name, so the proxy serves plain HTTP.
2. Follow steps 1 and 2 above, and give `setup` the tenant domain, `comics.localhost`.
3. Open `http://admin.comics.localhost` to sign in.

The tenant site answers at `http://comics.localhost`, and the Platform Console, if you turned it on with `PUBLIRA_PLATFORM_APP_URL=http://platform.localhost`, at that address.

The proxy publishes port 443 as well, even while it serves plain HTTP, so `docker compose up` fails to start it when something on your computer already listens on either port. For port 443, set `PUBLIRA_EDGE_HTTPS_PORT` to another free port, such as `8443`; nothing else changes, since the trial never uses it. For port 80, set `PUBLIRA_EDGE_HTTP_PORT` to another port, such as `8080`, and add it to every address above: the tenant domain you give `setup` is then `comics.localhost:8080`, and the console opens at `http://admin.comics.localhost:8080`. The port is part of the domain whenever browsers reach the install on a port other than 80 or 443, though not of the names the proxy lists.

Use this only for trying the install: nothing it sends between your browser and the host is encrypted, and the proxy answers on every interface of your computer, not only to the computer itself.

## A CDN or a load balancer in front

If a CDN or a load balancer of your platform terminates TLS for the install instead, leave `PUBLIRA_EDGE_ACME_EMAIL` empty and have it forward to the proxy's port 80, keeping the `Host` header the browser sent: the proxy picks the tenant site, the tenant console, or the Platform Console from it, and Publira picks the tenant from it. A hop that reaches the proxy over HTTPS instead can leave it set, as long as the certificate authority still reaches the proxy on port 80 or 443 at each host name.

The proxy then records every request with the hop's address, so the audit log shows one address for everyone, and the limits Publira keeps per client address are shared by every reader. To record the reader's address instead, have the hop set `X-Forwarded-For`, `X-Forwarded-Host`, and `X-Forwarded-Proto` itself, and set `PUBLIRA_EDGE_TRUSTED_PROXIES` in `.env` to the addresses or CIDR ranges it connects from, which its provider publishes, separated by spaces. Then run `docker compose up -d proxy` to recreate the proxy with them. [A hop in front of the proxy](./4-edge.md#a-hop-in-front-of-the-proxy) explains what trusting the hop means.

## What one host does not give you

The Compose file is a complete install, but every part of it is on one machine:

- **There is no redundancy.** Each process runs once. Docker restarts a process that exits, and restarts the whole install when the host reboots, but while the host is down, so is every tenant's site.
- **The database and the images share one disk.** PostgreSQL and RustFS keep their data in the `publira-deploy_postgres-data` and `publira-deploy_rustfs-data` volumes, on the host's own disk. A disk that fails takes both with it, so back up both, and `.env` with them: without the encryption keys in it, the SMTP password and every other credential the install stores cannot be read. Valkey keeps nothing that needs a backup, and neither does the `publira-deploy_caddy-data` volume: the proxy obtains the certificates again when it finds it empty. [Backup and restore](./8-backup-and-restore.md#on-the-docker-compose-install) has the commands.
- **`docker compose down -v` deletes the data.** `-v` removes the volumes, and with them every row and every image. Leave it out to stop the install and keep them.

When the install outgrows one host, the same processes run against a managed PostgreSQL and an S3-compatible object store elsewhere; [Installing](./2-installing.md) brings up such an install step by step.

## Next steps

When you add a tenant, add its domain and its console host to the host lists in `.env`, and run `docker compose up -d proxy`: the proxy routes the two names and obtains their certificates. [Adding a tenant](./4-edge.md#adding-a-tenant) lists the order, DNS first.

On every later release, [Upgrading](./7-upgrading.md#on-the-docker-compose-install) takes the install to it: checking out the release, the backup, the migrations, and restarting on the new images.

The full list of variables the Compose file reads, and the checks the repository runs against it, are in the [deployment reference](https://github.com/publira/publira/blob/main/infra/deploy/README.md#running-it-with-docker-compose).
