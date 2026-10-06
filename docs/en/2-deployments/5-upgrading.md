---
title: Upgrading
description: Bring a running install to a new release, from the backup before it to the processes of the new release serving.
published: 2026-10-06
---

A release can change the database schema its processes expect, so upgrading an install is more than restarting it on new images. The database goes first: the `publiractl` image of the new release brings the schema and the database roles forward, and only then do the processes of the new release start on it. This page goes through that order, how to check each step, and what to do when a migration fails.

The steps are written for an install you run yourself, as [Installing](./2-installing.md) brings up. The install from the repository's Compose file runs the same steps with commands of its own, in [On the Docker Compose install](#on-the-docker-compose-install).

## Before you start

### Read the release notes

Each release is a tag of the repository, published with its release notes on the repository's [Releases](https://github.com/publira/publira/releases) page. Read the notes of every release after the one you run, up to and including the one you upgrade to. Skipping releases is fine as far as the schema goes, since `db migrate` applies the migrations of every release in between in one run, but nothing applies what the notes ask of you.

These are the changes that ask something of you, and the notes name each one:

- **An environment variable added, renamed, or no longer read.** Set it before the processes of the new release start.
- **A new database role.** `db roles` needs a password for a role that does not exist yet: generate one as you did at install, and pass it with that role's flag.
- **A change to the routing.** If you adapted one of the [sample proxy configurations](./4-reverse-proxy.md#choose-a-sample), carry the change into your copy. `git diff <current tag> <new tag> -- infra/proxy/` shows it.
- **A process or a service the install has to run** that it did not run before.
- **A migration that runs long or locks a busy table**, so that you can choose when to run it.

### Get the images of the new release

Build or pull every image of the new release, and push them where your hosts pull from, before you change anything. The time between applying the migrations and restarting the processes is then only the time the processes take to start.

Every image has to come from the same release. `publiractl` carries the migrations and the role definitions of its release, each process expects the schema of its own, and the web apps call the API of the `publira server` they were released with.

The examples on this page name the images `publira/<name>:<new tag>`; put your own registry in front.

### Decide whether to stop the processes first

Publira makes no promise yet about running two releases side by side, yet an upgrade has two moments where they do run side by side:

- **Between `db migrate` and the restart**, the processes of the release you run serve on the schema of the new one. A migration that only adds tables and columns leaves them working, but a release may also drop or rename a column they still read, and every request that reads it fails until the new processes are up.
- **During a rolling restart**, the web apps of one release call the `publira server` of the other, and nothing promises that the two agree on the API.

So replace all four processes together, rather than one replica at a time, and keep the window short.

Processes left running also keep writing after you take the backup. If a migration then fails and you go back to the backup, everything written since it is discarded: every sign-up, purchase, comment, and edit made in the meantime, including purchases a payment provider has already charged for.

Stopping the processes before the backup avoids both: no request fails, and the backup holds every write, because nothing writes after it. The install is then down from the backup until the processes of the new release start. Stop them first whenever losing those writes is not acceptable, which on an install that sells episodes is every time.

## Upgrade

### 1. Back up the database

If you decided to stop the processes, stop them now, before the backup.

`publiractl` brings the schema forward only, and nothing undoes a migration once it has been applied. The backup you take now is the way back to the release you run.

```bash
pg_dump --format=custom --file=publira-before-upgrade.dump --dbname="$PUBLIRA_DB_URL"
```

`PUBLIRA_DB_URL` is the superuser connection `db migrate` uses, and `pg_dump` has to be the major version of your PostgreSQL server or newer. A snapshot from a managed PostgreSQL does the same job. The migrations change nothing in the object store, in Valkey, or in your secrets, so the database is the part to back up right before them. Keep the backup until the new release has served for a while.

### 2. Apply the migrations

```bash
docker run --rm -e PUBLIRA_DB_URL publira/publiractl:<new tag> db migrate
```

It logs the version it starts from and, when it is done, the version it ended at:

```text
time=2026-11-20T09:41:02.118Z level=INFO msg=migrating from_version=20261006125036
time=2026-11-20T09:41:03.402Z level=INFO msg=migrated from_version=20261006125036 to_version=20261120093000
```

When the release brings no migration, both versions are the same, and it exits zero all the same.

The migrations run before the new processes start because the processes do not check the schema when they start. Started on the old schema, they would come up healthy and then fail every request that reaches a table or a column the release added.

### 3. Bring the roles up to date

```bash
docker run --rm -e PUBLIRA_DB_URL publira/publiractl:<new tag> db roles
```

Without flags, every role keeps its password, and the command only brings the roles to what the new release defines: the grants on the tables the migrations just created, and whatever else the release changed in what a role may reach. It prints one line per role, `publira_public: kept its password` and so on. Skipped, it leaves the new processes failing with a permission error on every table the release added.

If the release adds a role, pass that role's password with its `--<name>-password-file` flag, as in [Create the roles](./2-installing.md#2-create-the-roles). Without one, the command exits naming the flag it needs and creates nothing.

### 4. Restart the processes on the new images

Replace `publira server`, `publira worker`, `web-host`, and `web-admin` with the images of the new release, together with `web-platform` and `email-renderer` if you run them, and with any variable the release notes asked you to set.

`publira worker` applies the migrations of its own job queue when it starts, so its tables need no step of their own.

### 5. Check the install

- Every process answers `GET /readyz` as ready.
- `db version` reports the newest migration of the release, and no dirty state:

  ```bash
  docker run --rm -e PUBLIRA_DB_URL publira/publiractl:<new tag> db version
  ```

  ```text
  version 20261120093000
  dirty false
  ```

  The version is the timestamp at the start of the newest file in `db/migrations/` at the new tag.

- The tenant console signs you in, and the tenant's site opens.

## When a migration fails

`db migrate` exits non-zero, logging `failed to migrate` with the error PostgreSQL returned, and `db version` reports a dirty state:

```text
version 20261120093000
dirty true
```

This is what the database holds then:

- Every migration before the failed one is applied, and stays applied.
- When PostgreSQL refused the failed migration, it is rolled back. A migration file runs as one transaction, so none of its statements stay. The exception is a migration that builds an index with `CREATE INDEX CONCURRENTLY`, which runs outside a transaction: when it fails, it leaves an invalid index of that name behind.
- When the connection dropped instead, the failed migration may have been committed before the answer was lost, and `db migrate` cannot tell which.
- The version recorded is the failed migration's, marked dirty, and `db migrate` refuses to run again until the mark is cleared.

The processes you were running keep running on the migrations applied so far, as they do between any `db migrate` and the restart. Do not start the processes of the new release on it.

### Run it again after fixing the cause

The log tells the two cases apart. When PostgreSQL refused the migration, the `failed to migrate` line ends with the error it returned and its SQLSTATE, such as `(details: ERROR: canceling statement due to statement timeout (SQLSTATE 57014))`. A dropped connection names a network error instead, with no SQLSTATE.

When PostgreSQL refused the migration for a cause outside it — the disk filled up, a statement timed out waiting on a busy table — fix the cause, set the record back to the migration before the failed one, and run `db migrate` again:

1. Find the version of the migration before the failed one. From the root of a checkout of the new release, this prints it first:

   ```bash
   ls db/migrations | grep '\.up\.sql$' | grep -B1 '^20261120093000_'
   ```

   The same list is under `db/migrations/` of the new tag on GitHub.

2. If the failed migration creates an index `CONCURRENTLY`, drop the invalid index it left, as the superuser:

   ```sql
   DROP INDEX CONCURRENTLY IF EXISTS <index name>;
   ```

3. Set the record back, as the superuser:

   ```sql
   UPDATE schema_migrations SET version = <previous version>, dirty = false;
   ```

4. Run `db migrate` again. It starts from the migration that failed; once it succeeds, carry on from [step 3](#3-bring-the-roles-up-to-date).

When the connection dropped, look first for the failed migration's changes in the database, reading its `.up.sql` file at the new tag. Since a migration runs as one transaction, either all of them are there or none is:

- **None is there**: the migration was rolled back. Follow the steps above.
- **All of them are there**: the migration was committed. Set the record to the failed migration itself rather than the one before, with `UPDATE schema_migrations SET version = <failed version>, dirty = false;`, and run `db migrate` again to carry on with the migrations after it.
- **You cannot tell**, as with a migration that only changes rows and leaves nothing to look for: go back to the release you ran, below. Running such a migration a second time could change the same rows twice.

### Go back to the release you ran

When the migration itself is at fault, or you cannot find the cause or tell whether it was applied, restore the backup and keep running the release you had. Restoring discards everything written after the backup, so if the processes kept running through the upgrade, the writes they made since are lost. Report the failure in an [issue](https://github.com/publira/publira/issues), with the log of `db migrate` and the output of `db version`.

1. Stop the processes: a database cannot be dropped while they hold connections to it.
2. Drop the database, and create it again empty, with the same owner and settings you first created it with.
3. Restore the backup into it:

   ```bash
   pg_restore --dbname="$PUBLIRA_DB_URL" publira-before-upgrade.dump
   ```

   The roles belong to the PostgreSQL server rather than to the database, so they survive the drop, and the backup carries their grants.

4. Start the processes of the release you ran.

A snapshot from a managed PostgreSQL is restored the way its provider describes, in place of the steps above.

## On the Docker Compose install

The [Docker Compose](./3-docker-compose.md) install runs every step above with `docker compose`. Run each command from `infra/deploy/` in your checkout.

### 1. Check out the new release

```bash
git fetch --tags
git diff <current tag> <new tag> -- .env.example
git checkout <new tag>
```

`.env` is not tracked, so the checkout leaves it as it is. The diff shows every variable the new release added to the Compose file or stopped reading: add the new ones to `.env`. A required one left empty stops every `docker compose` command and names the variable.

Then set `PUBLIRA_IMAGE_TAG` in `.env` to the new tag.

### 2. Get the images

```bash
docker compose pull
```

If you build the images on the host rather than pull them from a registry, build them again from the new checkout instead, with `task docker:verify:full`.

### 3. Back up the database

If you decided to [stop the processes](#decide-whether-to-stop-the-processes-first), stop them first, naming `web-platform` and `email-renderer` too if you run them:

```bash
docker compose stop server worker web-host web-admin
```

Then take the backup:

```bash
docker compose exec -T postgres pg_dump -U postgres --format=custom publira > publira-before-upgrade.dump
```

`-T` keeps the dump from passing through a terminal, which would corrupt it.

### 4. Apply the migrations and bring the roles up to date

```bash
docker compose run --rm publiractl db migrate
docker compose run --rm publiractl db roles
```

If the release adds a role, pass its password the way you did at install, as `--<name>-password-file /run/secrets/<name>-db-password`, with the variable the `.env.example` diff showed set in `.env`.

### 5. Start the new release

```bash
docker compose up -d
docker compose restart proxy
docker compose ps
```

`up -d` recreates every container whose image or settings changed. The proxy needs the restart besides: it mounts the routing files of the checkout one by one, and `git checkout` replaces those files with new ones, so a proxy left running keeps reading the routing of the release you ran.

Then check the install as in [step 5](#5-check-the-install), running `db version` as `docker compose run --rm publiractl db version`.

### When a migration fails on Compose

Run the SQL in [Run it again after fixing the cause](#run-it-again-after-fixing-the-cause) as the superuser through `psql` in the `postgres` container, one statement at a time:

```bash
docker compose exec postgres psql -U postgres -d publira -c "UPDATE schema_migrations SET version = <previous version>, dirty = false"
```

To go back to the release you ran instead:

```bash
docker compose stop server worker web-host web-admin
docker compose exec postgres psql -U postgres -d postgres -c 'DROP DATABASE publira' -c 'CREATE DATABASE publira'
docker compose exec -T postgres pg_restore -U postgres -d publira < publira-before-upgrade.dump
git checkout <current tag>
```

Set `PUBLIRA_IMAGE_TAG` back to the release you ran, and start it with `docker compose up -d` and `docker compose restart proxy`.

## Next steps

What each `db` command does, and every flag of `db roles`, is in the [`publiractl` reference](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#db), and the variables each process reads, in case the release notes name one, are in the [deployment reference](https://github.com/publira/publira/blob/main/infra/deploy/README.md#environment-variables).
