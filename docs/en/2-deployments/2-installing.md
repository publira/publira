---
title: Installing
description: Bring an empty install into service, from the services it depends on to the first sign-in to the tenant console.
published: 2026-10-06
---

This page takes an install from nothing to a tenant console its first administrator signs in to. It follows the order the steps have to run in and explains what each one decides; the full list of variables each process reads, and every flag of `publiractl`, stay in the reference linked from each step.

It describes the smallest install, the one in the [Overview](./1-overview.md): `web-host`, `web-admin`, `publira server`, and `publira worker`, managed from `publiractl`. [Turning on the optional processes](#turning-on-the-optional-processes) at the end adds the HTML mail and the Platform Console.

## Before you start

Build the images from the [image build instructions](https://github.com/publira/publira/blob/main/infra/docker/README.md) and push them where your hosts pull from. The examples here name them `publira/<name>:local`, the tags `task docker:verify:full` produces; use your own registry and tag in their place.

Every `publiractl` step runs the `publiractl` image of the release you are installing. It carries the migrations and the role definitions of that release, so an image from another release would apply a schema the processes do not expect.

To run the whole install on one host, the [Compose file](https://github.com/publira/publira/blob/main/infra/deploy/README.md#running-it-with-docker-compose) in the repository provisions the services and wires the variables for you. The steps below are still what it runs.

## Provision the services

Create these before the first step. Publira creates everything inside them, so each one starts empty.

- **A PostgreSQL database**, and a superuser login on it. Only `publiractl db migrate` and `publiractl db roles` connect as the superuser: `db roles` creates the login roles and an event trigger, which only a superuser may do. No long-lived process ever uses this login.
- **A Valkey instance**, or any server that speaks the Redis protocol. `publira server`, `web-host`, and `web-admin` share it for the image conversion cache, the rate limit counters, and the web apps' cache. A connection that carries a password has to use `rediss://`, with TLS: `publira server` refuses to start on a `redis://` URL with a password in it.
- **An empty bucket** in an S3-compatible object store, and a credential that can read and write it. Every uploaded image is kept there. `publiractl setup` saves the bucket and the credential, so the processes need nothing else to reach it. If the processes should use a credential from their environment instead, such as an instance role, leave the access key out at setup and give `publira server`, `publira worker`, and `publiractl` the `AWS_*` variables.
- **An SMTP account**: its host, port, encryption, user name and password, and the address mail is sent from. Reader sign-up, password reset, and administrator invitations all go through it.
- **DNS** for the tenant's domain and for `admin.<domain>`, both pointing at the reverse proxy. The first serves the tenant's public site and the second its console. If the console belongs on another host name, choose it now: `publiractl setup` takes it as `--admin-domain`.

## Generate the secrets

An install needs a handful of secrets that only you hold. Generate a fresh set for every environment, keep them in your secret store, and never reuse a value written in the repository: those are for local development and are public.

| Secret | Generate it with | Set on | What it protects |
| --- | --- | --- | --- |
| The secret encryption keys | `k1:$(openssl rand -base64 32)` as `PUBLIRA_SECRET_ENCRYPTION_KEYS`, and `k1` as `PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID` | `publira server`, `publira worker`, `publiractl` | Every credential the install stores: the SMTP password, the object store's secret key, the search engine's password, the Web Push private key, and each tenant's payment, push, and sign-in credentials |
| The access token signing key | `openssl rand -base64 32` as `PUBLIRA_AUTH_JWT_SECRET` | `publira server` | Every signed-in session. Whoever holds it can sign a token for any user and call every API as them |
| Each web app's session key | `openssl rand -base64 32` as that app's `PUBLIRA_AUTH_SECRET` | `web-host` and `web-admin`, one each | The session cookie, which carries the user's access token. The two apps may share one, but need not |
| The cache revalidation token | `openssl rand -hex 32` | `publira server` and `publira worker` as `PUBLIRA_REVALIDATE_TOKEN`, `web-host` and `web-admin` as `PNCH_REVALIDATE_TOKEN` | The endpoint the servers call to drop a web app's cached pages after a change. Without it the servers send nothing, and the web apps keep serving what they cached before the change |
| The web service token | `openssl rand -base64 32` as `PUBLIRA_WEB_SERVICE_TOKEN` | `publira server` and `web-admin` | The reads the console makes as itself rather than as one of its staff, such as the catalog lists every staff member sees alike, so it can cache them once for all of them. `web-admin` does not start without it |
| One password per database role | `openssl rand -hex 32`, six times | `publiractl db roles`, and the connection URL of the process that uses the role | The database itself. A connection URL carries the password unescaped, so keep to URL-safe characters, as the hex output does |

The encryption keys need the most care. `publiractl setup` seals the SMTP password and the object store's key with them, and `publira server` and `publira worker` unseal them with the keys they were given. A process given other keys cannot read what `publiractl` stored: the worker would fail to send mail, and the server to reach the object store. Lose the keys and every stored credential has to be entered again. To replace a key later without losing what it sealed, add the new key beside the old one rather than in its place, as [the rotation procedure](https://github.com/publira/publira/blob/main/server/README.md#secret-encryption-configuration-aes-gcm) describes.

## The database roles

The processes never connect as the superuser. `publiractl db roles` creates six login roles, and each part of the install connects as the one that matches what it does:

| Role | Connects for | What it can reach |
| --- | --- | --- |
| `publira_public` | `publira server`, serving the public site and the mobile app | The rows of the tenant the request is for |
| `publira_admin` | `publira server`, serving the tenant console | The rows of the tenant the request is for |
| `publira_platform` | `publira server`, serving the Platform Console, and the `publiractl` commands that change platform settings, `setup` among them | Every tenant, and the platform's own settings |
| `publira_outbox` | `publira worker`, sending mail and push notifications and revalidating caches | Every tenant, and the platform settings its mail needs |
| `publira_ticker` | `publira worker`, running the jobs that act the moment a scheduled time passes, such as publishing an episode | The few tables those jobs touch |
| `publira_content_stats` | `publira worker` and `publiractl job`, running the maintenance and aggregation jobs | Every tenant, and the platform settings those jobs read |

The split is what keeps one tenant's data away from another's. The two roles that answer requests from readers and from a tenant's staff are bound by row-level security to the tenant a request names, so a defect in one of those paths cannot read another tenant's rows. The platform's own tables, which hold the operators' password hashes and the platform's mail credentials, are out of reach of every role but `publira_platform` and the narrow reads the worker's roles are granted back. Each process therefore gets one connection URL per role it uses, and the [deployment reference](https://github.com/publira/publira/blob/main/infra/deploy/README.md#per-process) names which variable carries which.

## Bring the install up

### 1. Apply the migrations

Run `db migrate` on the superuser connection. It creates the schema, and exits without changing anything when there is nothing to apply.

```bash
docker run --rm -e PUBLIRA_DB_URL publira/publiractl:local db migrate
```

`PUBLIRA_DB_URL` is the superuser connection, such as `postgres://postgres:<password>@db.internal:5432/publira?sslmode=require`.

### 2. Create the roles

Run `db roles` on the same connection, giving each role the password you generated for it. It grants on the tables the migrations created, which is why it runs second.

```bash
docker run --rm -e PUBLIRA_DB_URL -v /run/secrets:/run/secrets:ro publira/publiractl:local db roles \
  --public-password-file /run/secrets/publira-public-db-password \
  --admin-password-file /run/secrets/publira-admin-db-password \
  --platform-password-file /run/secrets/publira-platform-db-password \
  --outbox-password-file /run/secrets/publira-outbox-db-password \
  --ticker-password-file /run/secrets/publira-ticker-db-password \
  --content-stats-password-file /run/secrets/publira-content-stats-db-password
```

Running it again changes nothing but the passwords it is given, so it is also how a role's password is rotated later. The other ways to pass a password are in the [`publiractl` reference](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#db).

### 3. Start the four processes

Start `publira server`, `publira worker`, `web-host`, and `web-admin` with the variables in the [deployment reference](https://github.com/publira/publira/blob/main/infra/deploy/README.md#environment-variables). Each connection URL names its role and the password `db roles` gave it, such as `postgres://publira_public:<password>@db.internal:5432/publira?sslmode=require` for `PUBLIRA_PUBLIC_DB_URL`. Set every one of them: a connection URL left unset falls back to a development URL, not to another of your variables, and fails to sign in.

`publira worker` creates the tables of its job queue when it starts, so it needs no step of its own. `publira server` and `publira worker` each report one check per database login in `GET /readyz`, so a role whose password does not match is named there.

### 4. Set the install up

`publiractl setup` saves what the install needs to serve its first tenant and creates the tenant's first administrator:

1. The platform's default locale, and the time zone new tenants start on.
2. The object store, after a connection test it has to pass.
3. Optionally, the catalog search engine, which is the database itself unless you choose another.
4. The SMTP settings, and a test message if you give an address for one.
5. Optionally, Web Push.
6. The tenant, on its domain.
7. Its first administrator, with a password you type or one it generates.

It connects as `publira_platform`, and seals the credentials it saves with the encryption keys, so give it the same keys the processes run with:

```bash
docker run --rm -it \
  -e PUBLIRA_PLATFORM_DB_URL \
  -e PUBLIRA_SECRET_ENCRYPTION_KEYS -e PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID \
  publira/publiractl:local setup
```

On a terminal it asks for every value. The same run can be made unattended, from a CI job or an init container, with every value given as a flag; that form is in the [`publiractl` reference](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#setup). The links it prints are built on `PUBLIRA_TENANT_URL_SCHEME`, the scheme readers' browsers reach the tenant on, which is `https` unless set. It describes the public address, not how the proxy reaches the processes, so a plain HTTP hop behind the TLS terminator does not change it. Set it to `http` only when browsers really open the tenant over HTTP, and then on `publiractl` and the processes alike.

A run that stops halfway, because a connection test failed for instance, is finished by running it again: it keeps every step already saved and asks only for the rest.

The summary at the end names the tenant site and the tenant console, and prints the administrator's password when it generated one. That is the only place the generated password appears, so keep it before you close the terminal.

### 5. Put the reverse proxy in front

Route the two host names to the processes:

- `admin.<domain>`, or the console host you chose, to `web-admin`.
- The tenant's domain to `web-host`.
- `/api` and `/images` on either host to the edge listener of `publira server`, except `/api/v1`, which belongs to the web app the host picked.

Terminate TLS for both host names at the proxy. The [routing contract](https://github.com/publira/publira/blob/main/infra/proxy/README.md) states the rules in full, and the repository ships sample configurations for Traefik, nginx, and Caddy that you adapt to your hosts.

### 6. Sign in

Open the tenant console URL the `setup` summary printed — `https://admin.<domain>`, or the console host you gave it with `--admin-domain` — and sign in with the administrator's email address and password. The tenant console opens on the tenant `setup` created, and from there its staff can be invited and the site configured. The tenant's public site answers at `https://<domain>`.

## Turning on the optional processes

Either process can be added to an install that is already serving. Neither one keeps data of its own; turning one on is a matter of running it and restarting the processes whose variables change.

### HTML mail with `email-renderer`

Without `email-renderer`, the worker sends every mail as plain text. Run it, and set `PUBLIRA_EMAIL_RENDERER_URL` on `publira worker` to its address on the private network, such as `http://email-renderer:8080`; from then on every mail carries an HTML part beside the same text. Once the variable is set, the renderer is part of sending mail: while it is down, the worker holds each mail and retries it rather than falling back to plain text.

### The Platform Console with `web-platform`

`web-platform` is the Platform Console, where operators manage tenants and platform settings from a browser rather than from `publiractl`. To run it:

- Generate a session key for it the way you did for the other web apps, and set it as its `PUBLIRA_AUTH_SECRET`, at least 32 bytes; without one no operator can sign in. Give it the same `PUBLIRA_GRPC_URL`, `PUBLIRA_WEB_SERVICE_TOKEN`, `PNCH_REDIS_URL`, and `PNCH_REVALIDATE_TOKEN` as `web-admin`.
- Set `PUBLIRA_WEB_PLATFORM_INTERNAL_URL` on `publira server` and `publira worker`, so cache revalidation reaches it, and `PUBLIRA_PLATFORM_APP_URL` on `publira worker`, the address operators open it at, which the links in its mail are built from.
- Point a `platform.` host name at the reverse proxy and route it to `web-platform`.

Open it and create its first operator on the setup screen. That operator is separate from the tenant administrator `publiractl setup` created: the Platform Console has accounts of its own, and the screen is offered until the first one exists. The language chosen on that screen becomes the platform's default locale, replacing the one `publiractl setup` saved; every other setting stays, and `publiractl` keeps working beside the console.

## Next steps

The full list of variables each process reads is in the [deployment reference](https://github.com/publira/publira/blob/main/infra/deploy/README.md), and the optional ones in the READMEs of [`publira server` and `publira worker`](https://github.com/publira/publira/blob/main/server/cmd/publira/README.md), [`web-host`](https://github.com/publira/publira/blob/main/apps/web-host/README.md), [`web-admin`](https://github.com/publira/publira/blob/main/apps/web-admin/README.md), and [`web-platform`](https://github.com/publira/publira/blob/main/apps/web-platform/README.md). Every `publiractl` command is in the [`publiractl` reference](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md).

On every later release, run `db migrate` and then `db roles` with that release's `publiractl` image before its processes start.
