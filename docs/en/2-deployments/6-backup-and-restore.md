---
title: Backup and restore
description: What an install keeps and has to be backed up, how to take a backup that restores, and how to bring an install back on empty services.
published: 2026-10-06
---

An install keeps its state in three places: the PostgreSQL database, the object store bucket, and the secret encryption keys, which only you hold. Restored without the others, each one is incomplete: rows name images the bucket does not have, the bucket holds images no row names, and the credentials in the database are sealed with keys nobody has. This page names what to back up and why, how to take a backup that restores into a working install, and how to bring an install back from it on empty services.

The steps are written for an install you run yourself, as [Installing](./2-installing.md) brings up. The install from the repository's Compose file runs the same steps with commands of its own, in [On the Docker Compose install](#on-the-docker-compose-install).

## What to back up

| What | What it holds | Back it up |
| --- | --- | --- |
| The PostgreSQL database | Everything the install stores, and the work it still has to do | Yes |
| The object store bucket | Every uploaded image | Yes, after the database |
| The secret encryption keys | The keys every stored credential is sealed with | Yes, apart from the database |
| The other secrets | The role passwords, the signing keys, and the tokens the processes share | Keep them; each one can be replaced |
| Valkey | Caches and counters | No |
| The search engine's index | A copy of the catalog, when the search runs on OpenSearch or Elasticsearch | No; it is rebuilt from the database |

### The database

The database holds every tenant, every account, the catalog, every comment and purchase, and every setting, the platform's and each tenant's. It also holds the work the install has not done yet: the mail and push notifications still to be sent, and the job queue of `publira worker`, whose tables live beside Publira's own. It is the authority over the bucket: an image exists for Publira when a row names it.

### The bucket

The bucket holds every image staff upload — covers, episode pages, logos, creator portraits — each one as a set of objects under `tenants/`, one per size and format. A row in the database names each object by its key, and Publira keeps nothing else in the bucket.

### The secret encryption keys

`PUBLIRA_SECRET_ENCRYPTION_KEYS` and `PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID` are not stored anywhere in the install. The database holds every credential sealed with them:

- The platform's SMTP password, the object store's secret key, the search engine's password, and the Web Push private key.
- Each tenant's own SMTP password, and its payment provider, App Store, Google Play, Firebase, Sign in with Apple, and inbound mail credentials.
- The two-step verification secret of every tenant console administrator who turned it on.

A database restored without the keys has every row, but none of these can be read. The worker cannot send mail, the server cannot reach the bucket, every tenant has to enter its credentials again, and no administrator's authenticator app passes two-step verification.

Keep every key the list holds, including one you rotated away from while a value is still sealed with it, and keep them apart from the database backups. A copy of the database together with the keys is every credential the install stores.

### What needs no backup

- **Valkey** holds the image conversion cache, the rate limit counters, and the web apps' cache. Every entry in it is either rebuilt from the database and the bucket or expires on its own, so an install starts on an empty Valkey without losing anything.
- **The search engine's index**, when the search runs on OpenSearch or Elasticsearch, is built from the database, and [rebuilt](#5-rebuild-the-search-index) after a restore.
- **The other secrets** can each be replaced. A role password is set again with `publiractl db roles`, and a new access token signing key or web app session key signs everyone out once. The cache revalidation token and the web service token only have to agree between the processes that share them. Keeping all of them in your secret store beside the encryption keys still saves you that work.
- **The images of the processes** are rebuilt or pulled for the release you run. Write down which release that is with every backup: a database backup restores onto the schema of the release it was taken on.

## Take a backup

Take the database first and the bucket after it. The keys do not change from one backup to the next: copy them to a safe place of their own when you generate or rotate one.

### 1. Back up the database

```bash
pg_dump --format=custom --file=publira.dump --dbname="$PUBLIRA_DB_URL"
docker run --rm -e PUBLIRA_DB_URL publira/publiractl:<tag> db version
```

`PUBLIRA_DB_URL` is the superuser connection, and `pg_dump` has to be the major version of your PostgreSQL server or newer. It reads every table in one snapshot, so the backup is consistent while the processes keep serving, and holds what was committed when it started.

`db version` prints the schema version of the database, which is the release the backup restores onto. Keep its output, and the release's tag, with the backup.

A snapshot from a managed PostgreSQL does the same job. It is restored the way its provider describes, and carries the roles with it.

### 2. Back up the bucket

Copy every object in the bucket to storage somewhere else, with any S3 client that copies a whole bucket, such as `aws s3 sync` or `rclone copy`. Use a copy that never deletes from its destination, which neither of those does, and copy into the same destination every time.

The order is what makes the two backups fit together. An upload writes the objects first and then the row that names them, and an object is never rewritten, so every object a row in the database backup names was already in the bucket when that backup started. Copied after it, the bucket backup has every one of them.

The one exception is an image replaced after the database backup started. Nothing names its old objects any more, and the worker's daily orphan purge deletes objects nothing names. If the purge runs before the copy reaches them, the restored row names objects the copy does not have, unless an earlier copy into the same destination already kept them. That is why the copy goes into a destination it never deletes from.

The bucket backup ends up holding more than the database backup names: every image uploaded while it ran, and every one replaced since the destination was first used. That costs space and nothing else. After a restore, the orphan purge deletes the objects no restored row names.

Copied the other way round, the bucket backup misses every image uploaded between the two backups, and the rows the database backup restores for them name objects that are not there. Those images show as broken on the site and in the console.

A provider's own tools, such as bucket versioning or replication to another region, serve the same purpose, as long as they keep the objects the purge deletes for as long as you keep the database backups that name them.

## Restore into an empty install

Restore onto the release the backup was taken on, with that release's `publiractl` image. To run a newer release, restore first and then [upgrade](./5-upgrading.md).

Provision the services as [Installing](./2-installing.md#provision-the-services) describes: a PostgreSQL server of the same major version or newer, with an empty database, an empty bucket, and an empty Valkey. Do not run `db migrate`: the backup brings the schema with it.

### 1. Restore the database

```bash
pg_restore --no-owner --no-acl --single-transaction --dbname="$PUBLIRA_DB_URL" publira.dump
```

`--single-transaction` restores everything or nothing. A restore that stops halfway leaves the database empty rather than missing the tables that came after the failure, which matters once the worker starts: it deletes from the bucket every object no row names.

`--no-owner` and `--no-acl` leave out the grants to the six roles, and the ownership of the job queue's tables by `publira_outbox`. Roles belong to the PostgreSQL server rather than to the database, so a new server does not have them yet, and every statement that names one would fail. Without them, every object is the superuser's, and the next step puts the grants back.

### 2. Create the roles

```bash
docker run --rm -e PUBLIRA_DB_URL -v /run/secrets:/run/secrets:ro publira/publiractl:<tag> db roles \
  --public-password-file /run/secrets/publira-public-db-password \
  --admin-password-file /run/secrets/publira-admin-db-password \
  --platform-password-file /run/secrets/publira-platform-db-password \
  --outbox-password-file /run/secrets/publira-outbox-db-password \
  --ticker-password-file /run/secrets/publira-ticker-db-password \
  --content-stats-password-file /run/secrets/publira-content-stats-db-password
```

It is the command [Create the roles](./2-installing.md#2-create-the-roles) runs at install, and it does the same here: it creates the six roles and grants them what the release defines, gives `publira_outbox` the job queue's tables, and sets every password. With the passwords the install ran with, the processes' connection URLs keep working; with new ones, update the URLs.

### 3. Restore the bucket

Copy every object from the bucket backup into the new bucket, under the same keys.

If the bucket has the name, the address, and the credential the install had, nothing else changes. Otherwise save the new bucket, as `setup` saved the old one, and test it:

```bash
docker run --rm -it \
  -e PUBLIRA_PLATFORM_DB_URL \
  -e PUBLIRA_SECRET_ENCRYPTION_KEYS -e PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID \
  publira/publiractl:<tag> storage set --bucket <bucket> --region <region> --access-key-id <access key>
```

Add `--endpoint` and `--force-path-style` for a store other than Amazon S3; every flag of `storage set` is in the [`publiractl` reference](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#storage).

### 4. Start the processes

Start `publira server`, `publira worker`, `web-host`, and `web-admin`, and `web-platform` and `email-renderer` if you run them, with the encryption keys the install ran with. The other secrets may be the ones you kept or new ones, set as [Generate the secrets](./2-installing.md#generate-the-secrets) describes.

Start them on an empty Valkey. A Valkey that served the install before the restore holds pages and images cached from data the restore took back, and the web apps would keep serving them until each entry expires. If it serves nothing else, empty it with `FLUSHALL`.

### 5. Rebuild the search index

When the search runs on OpenSearch or Elasticsearch, rebuild the index from the restored database:

```bash
docker run --rm \
  -e PUBLIRA_CONTENT_STATS_DB_URL \
  -e PUBLIRA_SECRET_ENCRYPTION_KEYS -e PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID \
  publira/publiractl:<tag> search reindex
```

An index that survived the restore still finds what was published after the backup, and links to series the restored database no longer has; an index that was lost leaves the search empty. On the default search, which is the database itself, there is nothing to rebuild.

### What the worker catches up on

`publira worker` treats the restored database like one it was away from since the backup was taken, and catches up as soon as it starts:

- **Mail and notifications.** Everything that was waiting to be sent when the backup was taken is sent, push notifications and cache revalidations included. Some of it went out after the backup, before the install was lost, so some readers and staff receive a mail a second time.
- **Scheduled work.** Every episode whose scheduled time passed since the backup is published, the cached pages catch up with every free window that opened or closed, and pinned announcements whose time ran out are unpinned.
- **The daily rebuilds.** The reading statistics, rankings, and recommendations are rebuilt for every day since the backup, from the reading activity the backup holds.
- **The orphan purge.** The first purge deletes the objects no restored row names once they are a day old: the images uploaded after the backup was taken.

### What a restore does not bring back

Everything written after the backup was taken: accounts readers created, comments, uploads, settings, and purchases. A payment provider, the App Store, or Google Play has already charged for a purchase made in that time, and the install no longer records it, so the buyer can no longer open the episode. Look for them in each provider's records, from the time of the backup to the time the install was lost.

## Verify a restore

- `db version` reports the version you kept with the backup, and no dirty state:

  ```bash
  docker run --rm -e PUBLIRA_DB_URL publira/publiractl:<tag> db version
  ```

- Every process answers `GET /readyz` as ready. `publira server` and `publira worker` report one check per database login, so a role whose password does not match its connection URL is named there.
- `storage test` passes. It reaches the bucket with the secret key the database holds sealed, so it also proves that the encryption keys are the right ones:

  ```bash
  docker run --rm \
    -e PUBLIRA_PLATFORM_DB_URL \
    -e PUBLIRA_SECRET_ENCRYPTION_KEYS -e PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID \
    publira/publiractl:<tag> storage test
  ```

- The tenant console signs you in, and the tenant's site opens with its images: a series' cover, and the pages of an episode uploaded shortly before the backup.

A backup that has never been restored is a hope rather than a backup. Restore one onto spare services from time to time, and go through this list on it.

## On the Docker Compose install

The [Docker Compose](./3-docker-compose.md) install keeps the database in the `publira-deploy_postgres-data` volume, the bucket in `publira-deploy_rustfs-data`, and the encryption keys and every other secret in `.env`. Run each command from `infra/deploy/` in your checkout.

### Take a backup

```bash
docker compose exec -T postgres pg_dump -U postgres --format=custom publira > publira.dump
docker compose run --rm -T publiractl db version > publira.version
docker compose stop rustfs
docker compose run --rm --no-deps -T --entrypoint tar rustfs -czf - -C /data . > publira-bucket.tar.gz
docker compose start rustfs
```

`-T` keeps the output from passing through a terminal, which would corrupt it.

The bucket is backed up as the files RustFS keeps in its volume, rather than object by object, since the RustFS image carries no S3 client. RustFS has to be stopped while they are copied, or the archive could hold an object it was halfway through writing. For that time, uploads in the console fail, and images that Valkey has not cached do not load; the rest of the site keeps serving. The checkout pins the RustFS image, so the same checkout restores the archive with the same RustFS.

Copy `publira.dump`, `publira.version`, and `publira-bucket.tar.gz` off the host, and keep the copy of `.env` you made at install somewhere other than both the host and those files.

### Restore

On a host with the checkout at the release of the backup, put `.env` back beside `compose.yaml`, then:

```bash
docker compose up -d --wait postgres
docker compose exec -T postgres pg_restore -U postgres -d publira --no-owner --no-acl --single-transaction < publira.dump
docker compose run --rm publiractl db roles \
  --public-password-file /run/secrets/public-db-password \
  --admin-password-file /run/secrets/admin-db-password \
  --platform-password-file /run/secrets/platform-db-password \
  --outbox-password-file /run/secrets/outbox-db-password \
  --ticker-password-file /run/secrets/ticker-db-password \
  --content-stats-password-file /run/secrets/content-stats-db-password
docker compose run --rm --no-deps -T --entrypoint tar rustfs -xzf - -C /data < publira-bucket.tar.gz
docker compose up -d
```

PostgreSQL creates the `publira` database empty on its first start, and the restore fills it. The archive goes into the RustFS volume before RustFS first starts, with the bucket and every object in it. Valkey keeps nothing, so it starts empty.

The commands expect a host where the install's two volumes do not exist yet. To restore over an install that is still on the host, remove it and its volumes first, with `docker compose down -v`. That deletes every row and every image it holds, so run it only with the backup at hand.

Then verify the restore as in [Verify a restore](#verify-a-restore), running `publiractl` as `docker compose run --rm publiractl db version` and `docker compose run --rm publiractl storage test`, and compare the version with `publira.version`.

## Next steps

What `db roles`, `storage`, and `search reindex` do, and every flag they take, is in the [`publiractl` reference](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md). Taking the upgrade further after a restore onto an older release is in [Upgrading](./5-upgrading.md).
