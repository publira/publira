---
title: Rotating secrets
description: Replace an install's secret encryption keys, a database role's password, and its signing keys and tokens without losing what they protect.
published: 2026-10-21
---

These procedures replace each secret that [Where each secret may go](./index.md#where-each-secret-may-go) names. Read them before you need them — each is easier to run on a quiet day than during an incident.

Generating the secrets for the first time is part of [Installing](../../2-deployments/2-installing.md#generate-the-secrets), and keeping them is part of [Backup and restore](../../2-deployments/9-backup-and-restore.md#the-secret-encryption-keys).

## Rotating the secret encryption keys

Every credential the install stores is sealed with the encryption keys, and each sealed value names the key that sealed it. `PUBLIRA_SECRET_ENCRYPTION_KEYS` lists every key a process can open values with, and `PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID` names the one it seals new values with. Rotating means adding a key, sealing with it, and moving the stored values onto it; a value whose key is no longer in the list cannot be opened at all.

### 1. Add the new key

Generate a key and give it an ID the list does not hold yet, such as `k2`. Add it beside the old one, and leave the primary key as it is:

```text
PUBLIRA_SECRET_ENCRYPTION_KEYS=k1:<old key>,k2:<new key>
PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID=k1
```

Restart `publira server` and `publira worker` with it, and use it for every later `publiractl` command. Keep the new key in your secret store and with your backups at once: from the next step on, values are sealed with it.

### 2. Make it the primary key

Once every process runs with both keys, change the primary key to `k2` and restart them again. Every value saved from then on is sealed with `k2`, and every value sealed with `k1` still opens.

The two restarts are separate on purpose. A process that does not have `k2` yet cannot open a value another process has already sealed with it, so while `publira server` or `publira worker` runs more than one instance, or restarts one after the other, switching the primary key in the same step leaves a window in which mail fails or a sign-in is refused.

On a [Docker Compose](../../2-deployments/3-docker-compose.md) install, each step is an edit to the two variables in `.env` followed by `docker compose up -d`, which restarts `server`, the worker with it, and leaves the rest running.

### 3. Seal the stored values again

Run `publiractl db reseal` on the administrative login's connection, with the same two variables the processes now have:

```bash
publiractl db reseal
```

It opens every sealed value in the database with the keys in the list and seals each one that names a key other than the primary again with the primary key: the platform's and every tenant's credentials, the two-step verification secret of every member of staff and operator, the token each Sign in with Apple link holds, the Web Push private key, and the ones that outbox entries carry to the worker. The values themselves stay the same, so nobody is signed out and nobody has to enter anything again, and the install keeps serving while it runs: a save that arrives meanwhile waits for it, or it for the save, and neither is lost.

It prints one line per key ID that a stored value names:

```text
KEY ID        RESEALED  ON PRIMARY  UNREADABLE
k1            42        0           0
k2 (primary)  0         3           0
```

`RESEALED` counts the values that key had sealed and the primary key now seals, `ON PRIMARY` the values the primary key had sealed already, and `UNREADABLE` the values no key in the list opens. To see the same table without writing anything, run `publiractl db reseal --dry-run`.

On a [Docker Compose](../../2-deployments/3-docker-compose.md) install, the `publiractl` service already has the administrative connection and the keys from `.env`:

```bash
docker compose run --rm publiractl db reseal
```

### 4. Remove the old key only when nothing uses it

Remove `k1` from the list only when `db reseal` exits `0`, with no value left in the `UNREADABLE` column. Running it again then prints a single line for the primary key, and every value it counts opens without `k1`.

When a value no key in the list opens, `db reseal` leaves it as it is, seals every other value, and exits `1`. Its log names each such value, with its column, its row, and the key ID it names, and the table counts it under that key ID. The value was sealed with a key that is no longer in the list, or with other key material under the same ID: put that key back in the list and run the command again. A value nobody holds the key to any more has to be entered again where it was saved, as a lost key requires.

A value whose key is gone cannot be opened: with `k1` removed while a Tenant admin's authenticator secret was still sealed with it, that administrator's sign-in fails at the two-step verification step with an error page, the server logs `secretcrypto: unknown key id: k1`, and the tenant's audit log records a failed **Two-step verification at sign-in** with the reason `secret_undecryptable`. Mail that needs a password sealed with the missing key is not sent either. Putting the key back in the list, and restarting, undoes all of it.

When a key has leaked, sealing again is not enough. Whoever holds the old key and any database backup taken before the rotation can open every value in that backup, so replace the credentials themselves where they were issued — a new SMTP password, a new access key for the bucket, new payment provider keys — and save the new ones. In the Platform Console, a new SMTP password is entered with **Change** beside **Password** under **Email**, and a new access key with **Replace access key** under **Storage**, as [Email](../6-email.md#changing-it) and [Object storage](../5-object-storage.md#rotating-the-access-key) describe.

![The SMTP Password with a password saved: the password is hidden, with Change under it.](./rotating-secrets-smtp-password.png)

![Storage's Credentials with an access key saved: the Access key ID, and the secret shown as Saved (hidden) with Replace access key.](./rotating-secrets-replace-access-key.png)

## Rotating a database role's password

A role has one password at a time, so a rotation is the change in PostgreSQL followed promptly by a restart of every process that connects as the role:

| Role | Connected to by |
| --- | --- |
| `publira_public`, `publira_admin` | `publira server` |
| `publira_platform` | `publira server`, and `publiractl` commands that change platform settings |
| `publira_outbox`, `publira_ticker` | `publira worker` |
| `publira_content_stats` | `publira worker`, and `publiractl job` |

1. Generate a new password with `openssl rand -hex 32`. Connection URLs carry it unescaped, which is why it is hex.
2. Run `publiractl db roles` on the administrative login's connection with that role's flag alone. Every other role keeps its password:

   ```bash
   publiractl db roles --admin-password-file /run/secrets/publira-admin-db-password
   ```

   It prints one line per role, `set its password` for the one you gave and `kept its password` for the others.

3. Change the connection URL of every process in the table above to the new password, and restart them.

Connections a process already has open stay signed in, so nothing fails the moment the password changes. Any connection it opens after that is refused, so do not leave a gap between the two steps. A process that restarts with the old password does not start at all: its log repeats `password authentication failed for user "publira_admin"`, and once it is running again, its `GET /readyz` names one check per role, so a mismatch is named there. Running `db roles` again with the password the process has puts it right.

To rotate every role at once, give `db roles` all six flags and restart `publira server` and `publira worker`.

On a Docker Compose install, the passwords are the `PUBLIRA_*_DB_PASSWORD` variables in `.env`, and the Compose file builds every connection URL from them. Change the variable, then:

```bash
docker compose run --rm publiractl db roles --admin-password-file /run/secrets/admin-db-password
docker compose up -d
```

`docker compose up -d` restarts only the processes whose connection URLs changed.

### The administrative login's password

`publiractl` does not manage the administrative login. Change its password in PostgreSQL, with `ALTER ROLE postgres PASSWORD '<new password>'` in `psql` or through your database provider, and then the `PUBLIRA_DB_URL` you run the `db` commands with. No long-lived process uses it, so nothing restarts.

On a Docker Compose install, PostgreSQL reads `PUBLIRA_POSTGRES_PASSWORD` only when it creates its volume, so changing `.env` alone changes nothing. Run `ALTER ROLE` with `docker compose exec postgres psql -U postgres -d publira`, then set the same value in `.env`. The next `docker compose up -d` restarts the `postgres` container, since its variables changed, which interrupts every process for a few seconds.

## Rotating the signing keys and tokens

These values are read when a process starts. Rotating one is a matter of giving every process that holds it the new value and restarting them together; none of them is stored in the database, and none has to be kept once replaced.

| Value | Change it on | What the change does |
| --- | --- | --- |
| `PUBLIRA_AUTH_JWT_SECRET` | `publira server` | Signs everyone out: readers on every tenant's site and in its mobile app, staff in every tenant console, and operators in the Platform Console |
| `PUBLIRA_AUTH_SECRET` of one web app | That web app | Signs out the users of that app alone |
| The cache revalidation token | `publira server`, `publira worker`, and every web app | Signs nobody out |
| The web service token | `publira server`, `web-admin`, and `web-platform` | Signs nobody out |

On a Docker Compose install, the variables are `PUBLIRA_AUTH_JWT_SECRET`, `PUBLIRA_WEB_STOREFRONT_AUTH_SECRET`, `PUBLIRA_WEB_ADMIN_AUTH_SECRET`, `PUBLIRA_WEB_PLATFORM_AUTH_SECRET`, `PUBLIRA_REVALIDATE_TOKEN`, and `PUBLIRA_WEB_SERVICE_TOKEN` in `.env`. Change one, and `docker compose up -d` restarts exactly the processes that read it.

### The access token signing key

Every session is an access token signed with this key, so a new key ends them all at once. A reader or a member of staff who opens a page is sent to the sign-in screen with "Your session has expired. Please sign in again." The session of a tenant's mobile app is the same kind of token, so it ends too. A member of staff halfway through a two-step verification sign-in starts again from the password.

The links to an episode's images carry a short-lived token signed with the same key. A tenant's site keeps the page of a free episode cached for up to an hour, links included, so a free episode's images can fail to load until that page is rebuilt.

Rotate it whenever it may have leaked, and whenever a session key has: a session cookie carries an access token that stays valid for a day, and only a new signing key ends it sooner.

### A web app's session key

Each web app seals its session cookie with its own `PUBLIRA_AUTH_SECRET`. A new key makes every cookie it sealed unreadable, so its users land on the sign-in screen, without a message, while the other apps keep their sessions. Rotating the key of `web-storefront` signs readers out of the site but not out of the mobile app, and cancels a Sign in with Apple or Google that was under way; rotating the key of `web-admin` also cancels a two-step verification sign-in that was under way.

The value has to be at least 32 bytes, and only its first 32 bytes are used, so generate a whole new one with `openssl rand -base64 32` rather than editing the end of the old one.

### The cache revalidation token

`publira server` and `publira worker` send it with every request to drop a web app's cached pages, and each web app refuses a request whose token does not match its own. While the two sides disagree, every drop is refused with `401`, and the worker logs each attempt as `outbox event retry scheduled` with `revalidate endpoint returned status=401`. The worker keeps trying each drop for about nine minutes, so restarting every process with the new token within that time loses nothing; a drop that runs out of attempts leaves the pages it named as they were, as [Scheduled and maintenance jobs](../10-scheduled-jobs.md#seeing-what-was-given-up) describes.

### The web service token

`web-admin` and `web-platform` send it to read what every member of their staff sees alike. While `publira server` holds a different one, those reads are refused, and both consoles show "Your session is no longer valid. Please sign in again." on their dashboards. Signing in again does not help: restart all three with the same token.
