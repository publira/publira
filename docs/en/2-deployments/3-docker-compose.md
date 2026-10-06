---
title: Docker Compose
description: Run a whole install on one host with the Compose file in the repository, from filling in its .env to the first sign-in to the tenant console.
published: 2026-10-06
---

The repository ships a Compose file that runs a whole install on one host: the services Publira depends on, the four processes, and a reverse proxy in front of them, already wired together. It is the shortest way to a working install, and this page takes you from an empty host to the first sign-in to the tenant console.

The Compose file runs the same steps as [Installing](./2-installing.md), which explains why each step exists, what every secret protects, and what each database role can reach. This page covers what is particular to the Compose file: what it runs, what you fill in, and the commands that bring it up. The full list of variables it reads is in the [deployment reference](https://github.com/publira/publira/blob/main/infra/deploy/README.md#running-it-with-docker-compose).

## What the file runs

[`infra/deploy/compose.yaml`](https://github.com/publira/publira/blob/main/infra/deploy/compose.yaml) defines these services:

| Service | What it is | What it keeps on the host |
| --- | --- | --- |
| `postgres` | PostgreSQL, holding everything the install stores | The `postgres-data` volume |
| `valkey` | Valkey, holding the image conversion cache, the rate limit counters, and the web apps' cache | Nothing; it starts empty after every restart |
| `rustfs` | [RustFS](https://github.com/rustfs/rustfs), an S3-compatible object store, holding every uploaded image | The `rustfs-data` volume |
| `proxy` | Traefik, the reverse proxy, with the repository's own routing | Nothing |
| `server`, `worker`, `web-host`, `web-admin` | The four processes the [Overview](./1-overview.md) describes | Nothing |
| `web-platform`, `email-renderer` | The optional processes, which run only when you turn them on | Nothing |
| `publiractl` | The command-line tool, never kept running: you run it with `docker compose run --rm publiractl <command>` | Nothing |

The proxy publishes plain HTTP on a port of the host's loopback interface and nothing else, so nothing reaches the install until you put a TLS terminator on the host in front of it. Every other service is reachable only from the others.

The project name is fixed as `publira-deploy`, so the volumes keep their names across every command you run, and one host runs one install.

## Before you start

You need:

- **A host with Docker Engine and the Compose plugin**, `docker compose`.
- **A checkout of the repository at the release you install**, such as a clone checked out at that release's tag. The Compose file is not self-contained: it mounts the proxy's routing from `infra/proxy/`, so keep the whole checkout rather than copying `infra/deploy/` out of it. Every command on this page runs from `infra/deploy/`.
- **The images of that release**, `publira`, `publiractl`, `web-host`, and `web-admin`, plus `web-platform` and `email-renderer` if you will run them. Build them from the [image build instructions](https://github.com/publira/publira/blob/main/infra/docker/README.md) and push them to a registry the host can pull from, or build them on the host itself: `task docker:verify:full` builds them all as `publira/<name>:local`.
- **An SMTP account**, which `publiractl setup` asks for: its host, port, encryption, user name and password, and the address mail is sent from.
- **DNS** for the tenant's domain and for `admin.<domain>`, both pointing at the host.

## Fill in `.env`

Every value the file needs comes from a `.env` file beside it. Copy the example, which lists every variable the file reads with a comment on each:

```bash
cd infra/deploy
cp .env.example .env
chmod 600 .env
```

`.env` holds every secret of the install, the encryption keys among them, so keep it readable by you alone and keep a copy of it somewhere other than the host.

### The images

`PUBLIRA_IMAGE_REGISTRY` and `PUBLIRA_IMAGE_TAG` name the images, as `<registry>/<name>:<tag>`. Every image runs the same tag, so set the tag of the release your checkout is at: `publiractl` carries the migrations of its release, and the processes expect the schema of theirs. The example's values, `publira` and `local`, name the images `task docker:verify:full` builds; for images in your own registry, set its address, such as `registry.example.com/publira`, and the release's tag.

### The edge port and the tenant URL scheme

`PUBLIRA_EDGE_PORT` is the loopback port the proxy publishes. The example's `8080` is fine unless something else on the host already listens there; whichever you choose, the TLS terminator forwards to it.

Leave `PUBLIRA_TENANT_URL_SCHEME` empty when browsers reach the install over HTTPS, which they do through a TLS terminator. It is the scheme of the links Publira builds, in mail and in the `setup` summary, not of the plain HTTP hop between the terminator and the proxy. Set it to `http` only when browsers really open the install over HTTP, as in [Trying it on one machine](#trying-it-on-one-machine).

### The secrets

Generate every one of these with the command beside it, a fresh value for every install:

| Variable | Generate it with |
| --- | --- |
| `PUBLIRA_POSTGRES_PASSWORD` | `openssl rand -hex 32` |
| `PUBLIRA_PUBLIC_DB_PASSWORD`, `PUBLIRA_ADMIN_DB_PASSWORD`, `PUBLIRA_PLATFORM_DB_PASSWORD`, `PUBLIRA_OUTBOX_DB_PASSWORD`, `PUBLIRA_TICKER_DB_PASSWORD`, `PUBLIRA_CONTENT_STATS_DB_PASSWORD` | `openssl rand -hex 32`, one each |
| `PUBLIRA_SECRET_ENCRYPTION_KEYS` | `echo "k1:$(openssl rand -base64 32)"` |
| `PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID` | `k1`, the ID in front of the key above |
| `PUBLIRA_AUTH_JWT_SECRET`, `PUBLIRA_WEB_HOST_AUTH_SECRET`, `PUBLIRA_WEB_ADMIN_AUTH_SECRET`, `PUBLIRA_WEB_SERVICE_TOKEN` | `openssl rand -base64 32`, one each |
| `PUBLIRA_REVALIDATE_TOKEN` | `openssl rand -hex 32` |
| `PUBLIRA_RUSTFS_ACCESS_KEY`, `PUBLIRA_RUSTFS_SECRET_KEY` | `openssl rand -hex 32`, one each |

The database passwords go into connection URLs unescaped, which is why they are hex. The first one is the PostgreSQL superuser's, which only `publiractl db migrate` and `db roles` connect as; the other six are the passwords `db roles` gives the roles the processes connect as. The two RustFS values are the object store's own credential: RustFS starts with it, and `publiractl setup` saves it as the credential Publira reaches the bucket with. What the rest protect is in [Generate the secrets](./2-installing.md#generate-the-secrets).

### What stops `docker compose`

Every value above is required. While one of them is empty, every `docker compose` command, `run` included, stops before it starts anything and names the variable:

```text
error while interpolating services.postgres.environment.POSTGRES_PASSWORD: required variable PUBLIRA_POSTGRES_PASSWORD is missing a value
```

The rest of the file may stay empty: `PUBLIRA_TENANT_URL_SCHEME`, `COMPOSE_PROFILES`, and the variables of the optional processes, which the next section fills in when you turn one on.

A variable exported in the shell you run `docker compose` from takes precedence over the same variable in `.env`. If a value you wrote in `.env` seems to be ignored, look for a `PUBLIRA_*` variable in your shell's environment.

## Choose the optional processes

The optional processes run when `COMPOSE_PROFILES` names them, as a comma-separated list. Each one also needs the variables listed under it in `.env`:

| Profile | What it adds | What else to set in `.env` |
| --- | --- | --- |
| `email-renderer` | An HTML part in every mail | `PUBLIRA_EMAIL_RENDERER_URL=http://email-renderer:8080` |
| `web-platform` | The Platform Console | `PUBLIRA_WEB_PLATFORM_INTERNAL_URL=http://web-platform:4100`, `PUBLIRA_PLATFORM_APP_URL` set to the address operators open it at, such as `https://platform.example.com`, and `PUBLIRA_WEB_PLATFORM_AUTH_SECRET` from `openssl rand -base64 32` |

For example, to run both:

```text
COMPOSE_PROFILES=web-platform,email-renderer
```

`docker compose` does not stop on an empty `PUBLIRA_WEB_PLATFORM_AUTH_SECRET`, since it only matters when the profile runs, but no operator can sign in to the Platform Console without it. The Platform Console also needs a `platform.` host name, such as `platform.example.com`, pointing at the host, and a certificate on the TLS terminator like the other host names.

You can choose these now or later. To turn one on in an install that is already running, add it to `COMPOSE_PROFILES`, set its variables, and run `docker compose up -d` again: it starts the new process and restarts the ones whose variables changed. What each process does once it runs is in [Turning on the optional processes](./2-installing.md#turning-on-the-optional-processes).

## Bring the install up

Run each step from `infra/deploy/`, in this order.

### 1. Apply the migrations and create the roles

```bash
docker compose run --rm publiractl db migrate
docker compose run --rm publiractl db roles \
  --public-password-file /run/secrets/public-db-password \
  --admin-password-file /run/secrets/admin-db-password \
  --platform-password-file /run/secrets/platform-db-password \
  --outbox-password-file /run/secrets/outbox-db-password \
  --ticker-password-file /run/secrets/ticker-db-password \
  --content-stats-password-file /run/secrets/content-stats-db-password
```

The first command starts PostgreSQL, waits until it accepts connections, and creates the schema. The second creates the six roles, and prints one line per role as it does. The files under `/run/secrets/` are the role passwords from `.env`, which the Compose file hands the `publiractl` container as files, so they never appear on a command line.

### 2. Start the install

```bash
docker compose up -d
docker compose ps
```

`docker compose ps` lists every service of the install as running; `publiractl` is not among them, since it only ever runs for one command. A process that keeps restarting says why in `docker compose logs <service>`.

### 3. Create the bucket

RustFS starts with no bucket, and Publira does not create one. Create it, named `publira`, with the RustFS credential from `.env`:

```bash
docker compose exec rustfs sh -c \
  'curl -fsS -X PUT --aws-sigv4 aws:amz:us-east-1:s3 --user "$RUSTFS_ACCESS_KEY:$RUSTFS_SECRET_KEY" http://localhost:9000/publira'
```

The command prints nothing when it succeeds. The single quotes matter: the two variables are expanded inside the `rustfs` container, which already has them, so the credential is never typed on the host.

### 4. Set the install up

Run `publiractl setup`, giving it the bucket you created and the RustFS credential. Write your `PUBLIRA_RUSTFS_ACCESS_KEY` in place of `<access key>`; the secret key is read from a file, the same way the role passwords were:

```bash
docker compose run --rm publiractl setup \
  --bucket publira --region us-east-1 --endpoint http://rustfs:9000 --force-path-style \
  --access-key-id <access key> --secret-access-key-file /run/secrets/rustfs-secret-key
```

`setup` asks on the terminal for everything the flags do not give: the platform's default locale and time zone, the SMTP settings, whether to set up Web Push, the tenant's name and domain, and its first administrator. It also asks for the object store's public base URL, which you leave blank, since nothing serves the bucket's objects directly, and then tests the bucket before it saves it. [Set the install up](./2-installing.md#4-set-the-install-up) describes each step.

When it asks for the tenant site domain, give the domain readers will open, such as `comics.example.com`. The console host defaults to `admin.<domain>`, which is what the proxy routes to the tenant console.

The summary at the end names the tenant site and the tenant console, and prints the administrator's password when `setup` generated one. That is the only place it appears, so keep it before you close the terminal.

### 5. Put TLS in front

The proxy speaks plain HTTP on `127.0.0.1:${PUBLIRA_EDGE_PORT}`, and browsers need HTTPS. Run a TLS terminator on the host that:

- Accepts HTTPS for the tenant's domain and `admin.<domain>`, plus the `platform.` host name if you run the Platform Console, with a certificate for each.
- Forwards every request to `http://127.0.0.1:<PUBLIRA_EDGE_PORT>`.
- Keeps the `Host` header the browser sent. The proxy picks the tenant site, the tenant console, or the Platform Console from it, and Publira picks the tenant from it, so a terminator that replaces it with `127.0.0.1` reaches no tenant at all.

[Caddy](https://caddyserver.com/) does all three with a few lines, and obtains and renews the certificates itself once DNS points at the host and ports 80 and 443 are open to the internet:

```text
comics.example.com, admin.comics.example.com {
	reverse_proxy 127.0.0.1:8080
}
```

Any other terminator that does the same works too. When you add a tenant later, [Adding a tenant](./4-reverse-proxy.md#adding-a-tenant) lists what the terminator and the proxy need for its host names.

### 6. Sign in

Open the tenant console URL the `setup` summary printed, `https://admin.<domain>`, and sign in with the administrator's email address and password. The tenant console opens on the tenant `setup` created, and the tenant's public site answers at `https://<domain>`.

If you turned on the Platform Console, open `PUBLIRA_PLATFORM_APP_URL` and create its first operator on the setup screen. Its accounts are separate from the tenant administrator's.

## Trying it on one machine

To try the install on your own computer, without DNS or certificates, use host names under `.localhost`. Chromium-based browsers and Firefox send every `.localhost` name to the machine itself, and treat it as secure even over plain HTTP, so they keep the session cookie that signing in sets. Over plain HTTP on any other host name, the sign-in seems to succeed, but the next page you open returns you to the sign-in screen.

1. Set `PUBLIRA_TENANT_URL_SCHEME=http` in `.env`.
2. Follow steps 1 to 4 above, and give `setup` the tenant domain with the edge port, such as `comics.localhost:8080`. The port is part of the domain whenever browsers reach the install on a port other than 80 or 443.
3. Skip step 5, and open `http://admin.comics.localhost:8080` to sign in.

The tenant site answers at `http://comics.localhost:8080`, and the Platform Console, if you turned it on with `PUBLIRA_PLATFORM_APP_URL=http://platform.localhost:8080`, at that address. Use this only for trying the install: nothing it sends between your browser and the host is encrypted.

## What one host does not give you

The Compose file is a complete install, but every part of it is on one machine:

- **There is no redundancy.** Each process runs once. Docker restarts a process that exits, and restarts the whole install when the host reboots, but while the host is down, so is every tenant's site.
- **The database and the images share one disk.** PostgreSQL and RustFS keep their data in the `publira-deploy_postgres-data` and `publira-deploy_rustfs-data` volumes, on the host's own disk. A disk that fails takes both with it, so back up both volumes, and `.env` with them: without the encryption keys in it, the SMTP password and every other credential the install stores cannot be read. Valkey keeps nothing that needs a backup.
- **`docker compose down -v` deletes the data.** `-v` removes the volumes, and with them every row and every image. Leave it out to stop the install and keep them.

When the install outgrows one host, the same processes run against a managed PostgreSQL and an S3-compatible object store elsewhere; [Installing](./2-installing.md) brings up such an install step by step.

## Next steps

On every later release, check out that release in the repository, set `PUBLIRA_IMAGE_TAG` to its tag, and then run:

```bash
docker compose pull
docker compose run --rm publiractl db migrate
docker compose run --rm publiractl db roles
docker compose up -d
```

`db roles` without flags keeps every password and only brings the roles' grants up to the new release.

The full list of variables the Compose file reads, and the checks the repository runs against it, are in the [deployment reference](https://github.com/publira/publira/blob/main/infra/deploy/README.md#running-it-with-docker-compose).
