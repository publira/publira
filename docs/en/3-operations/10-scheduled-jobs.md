---
title: Scheduled and maintenance jobs
description: What publira worker does on its own schedule, how it catches up after downtime, how it retries outgoing mail, push, and cache revalidation, and when to run a job by hand with publiractl job.
published: 2026-10-07
updated: 2026-10-07
---

Everything an install does without a request is done by `publira worker`: it publishes the episodes scheduled for now, tells the web apps which cached pages a change made stale, sends mail and push notifications, rebuilds the statistics and rankings, and deletes what has passed its retention period. Nothing else has to run on a timer, and no host cron or Kubernetes CronJob is needed. This page says what runs when, how to tell which job is behind a symptom, and how to run one by hand with `publiractl job`.

The interval of each job, the variables that tune it, and the full list of jobs are in the [`publira worker` reference](https://github.com/publira/publira/blob/main/server/cmd/publira/README.md#publira-worker) and the [`publiractl job` reference](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#job); this page does not repeat them.

## Which job is behind a symptom

Start from what you see, and look at the job that owns it:

| What you see | Job | Where to look |
| --- | --- | --- |
| An episode is still **Scheduled** after its time | Scheduled publication | [Scheduled publication](#scheduled-publication) |
| An episode's site page still shows it priced inside its free reading period, or free after it ended | Free reading periods | [Free reading periods](#free-reading-periods-and-other-cached-pages) |
| The storefront's weekly schedule still shows yesterday as today | The tenant day rollover | [Free reading periods](#free-reading-periods-and-other-cached-pages) |
| A site banner is still up after its **Stop showing at** time | Pinned announcements | [Free reading periods](#free-reading-periods-and-other-cached-pages) |
| A page keeps showing what it showed before a change | Cache revalidation, in the outbox | [The outbox](#the-outbox-mail-push-and-cache-revalidation) |
| A mail or a push notification never arrives | The outbox | [The outbox](#the-outbox-mail-push-and-cache-revalidation) |
| The rankings, series ratings, or recommendations stop moving | The statistics and ranking chain | [Statistics and rankings](#statistics-and-rankings) |
| A month is not closed on a tenant's close day | The royalty close | [Other scheduled jobs](#other-scheduled-jobs) |
| An episode bought on Google Play stays open after a refund | The Google Play refund sync | [Other scheduled jobs](#other-scheduled-jobs) |
| The search does not move to a newly saved engine | The search index build | [Search](./7-search.md#when-the-build-fails) |
| Old records are not deleted | The purges | [Other scheduled jobs](#other-scheduled-jobs) |

Every one of them first needs `publira worker` to be running and ready: an install whose worker is stopped serves every page, but publishes nothing, sends nothing, and rebuilds nothing. `GET /readyz` on the worker names a check for each of its three database logins, so a login that stopped answering is named there.

### Where a job's failures are recorded

The worker logs every failure, and the log line names the job. Every run of a scheduled job also leaves a row in the `river_job` table of the database, where the worker queues its own work, so that table shows whether a job ran at all, and when.

What the row says about a failure depends on the job. The publication, free reading period, day rollover, and pinned announcement jobs finish their run even when something in it failed: each logs what it could not finish and leaves it for its next run, a minute later, so their rows read as completed and the failure is in the log alone. Every other job records a failed run in its row, keeping every attempt's error in the `errors` column, naming the tenant and the day it stopped on. Query it with `psql`, connected as the database's superuser:

```sql
SELECT kind, state, attempt, finalized_at, errors
FROM river_job
WHERE state IN ('retryable', 'discarded')
ORDER BY id DESC
LIMIT 20;
```

`retryable` is a pass waiting for another attempt, and `discarded` one that ran out of attempts. A finished or cancelled row is deleted after a day, and a discarded one after a week, so look there soon after the symptom. The outbox keeps its own record, described [below](#seeing-what-was-given-up).

## Scheduled publication

An episode staff scheduled is published by the worker once its time has passed, together with the notifications to the series' followers and the drop of the cached pages that listed it as scheduled. The worker looks for due episodes every minute, so an episode goes live within about a minute of its time.

A publication that fails is tried again a few times within the same pass. When every attempt fails, the episode stays **Scheduled**, and the worker writes a notification titled "An episode could not be published" for the tenant's administrators, in the tenant console, and for every operator, under **Notifications** in the Platform Console. Each such notification is written once per episode. The worker tries the episode again on every later pass, so once the cause is fixed — a database that was failing, a migration that had not run — the episode goes out on its own. Setting a new time on the episode's page in the tenant console does not get around it, since that time is published by the same worker ([#3830](https://github.com/publira/publira/issues/3830)).

## Free reading periods and other cached pages

Three jobs exist only to keep the web apps' cached pages on the right side of a time that passed:

- **Free reading periods.** An episode inside a **Free reading periods** entry reads as free from the moment the period starts and is priced again once it ends, with no job involved: every read compares the period against the current time. What the job fixes is the pages a site cached before the boundary, which it marks stale at both ends of every period.
- **The tenant day rollover.** At each tenant's own midnight, in the tenant's time zone, it marks stale the storefront's weekly schedule, the one page whose answer is the tenant's calendar day.
- **Pinned announcements.** Once an announcement's **Stop showing at** time passes, it takes the announcement off the banner and marks the banner stale.

Each runs every minute. None of them drops a cache itself: each records the drop as an entry in the outbox, which the worker then sends to the web apps, so a page that stays stale while the worker has `PUBLIRA_REVALIDATE_TOKEN` is an outbox problem, described [below](#the-outbox-mail-push-and-cache-revalidation).

A worker started without `PUBLIRA_REVALIDATE_TOKEN` has cache revalidation turned off. These jobs then record no drop at all, yet still count each boundary as passed and take each banner down, so the outbox has nothing to retry, and restarting the worker with the token does not bring those drops back. The pages they would have dropped keep what they cached until the next change to the same thing drops them, or their cache runs out. Set the token on `publira server` and `publira worker` before the first boundary you need on time, as [Installing](../2-deployments/2-installing.md#generate-the-secrets) describes.

These jobs have no `publiractl job` command, and need none: each acts on every time that has passed whenever it runs, including the first run after the worker starts.

## Statistics and rankings

The statistics, rankings, series ratings, and recommendations are built from the reading activity once each day is over, in the tenant's own time zone. Four jobs do it, one after the other, as one chain:

1. **Reading projection** (`project-episode-reads`) files every finished read as an analytics event.
2. **Daily statistics** (`aggregate-content-stats`) rebuilds each finished day's views, completed reads, purchases, ratings, favourites, and comments per series and episode. The series ratings the storefront shows are computed from them.
3. **Rankings** (`aggregate-rankings`) rebuilds the daily and weekly leaderboards the storefront's **Ranking** pages show.
4. **Recommendations** (`build-recommend-features`) rebuilds the snapshot each reader's recommendations are drawn from.

The chain starts every hour, and each link starts the next when it ends. Since every tenant's midnight falls on a different hour, a tenant's day is rebuilt within about an hour after it ends, plus the time the chain takes. So a ranking that has not moved yet a few hours after a tenant's midnight is normal; one that has not moved for a day is not.

The worker remembers, per tenant, the last day each link finished, and starts from the day after it. A day that fails stops that tenant there while the other tenants carry on: the error is in the `river_job` row of the failing link, the pass is attempted up to three times, and the next hourly pass starts again from the day that failed. Once the cause is fixed, the tenant catches up on its own, every missed day in order.

## Other scheduled jobs

| Job | How often | What it does |
| --- | --- | --- |
| Royalty close (`close-royalty-statements`) | Every hour | Closes each month a tenant on **Close automatically** owes, once the tenant's close day has come. A month already closed, by hand or by an earlier pass, is left as it is |
| Google Play refund sync (`sync-google-play-voided-purchases`) | Every hour | Reads the purchases Google Play refunded in the last 30 days, for every tenant whose Google Play store is on, and takes them back, as [Selling episodes](../4-console/4-selling-episodes.md#refunds) describes |
| Search index build (`build-search-index`) | Every 30 seconds | Builds the index on a newly saved search engine and moves the search onto it, as [Search](./7-search.md#moving-to-another-engine) describes |
| The purges (`purge-*`) | Every hour or every 24 hours | Delete withdrawn comments, analytics events, and ranking snapshots past their retention period, as [Platform defaults and policies](./9-platform-policies.md#retention) describes; the challenges a two-step sign-in has finished with; and the images nothing on any tenant uses any more, once they are a day old |

## After downtime

A worker that was stopped, or that ran without a working database, does nothing for that time, and the work waits in the database rather than being lost. When it starts again:

| Job | On start |
| --- | --- |
| The outbox | Sends every entry that was waiting. An entry a stopped worker was in the middle of is picked up again after 15 minutes |
| Scheduled publication | Publishes every episode whose time passed, and notifies its followers |
| Free reading periods, the tenant day rollover, pinned announcements | Mark stale every page whose boundary passed in the meantime, and take down every banner whose time ran out |
| The statistics and ranking chain | Rebuilds every day each tenant missed, in order, except the days whose analytics events have already passed their retention period: those are logged as missing and skipped, and cannot be rebuilt |
| Royalty close | Closes every month that became owed |
| Search index build | Builds a pending index |
| The purges | Run only when none has finished in its current hour or day, counted on the clock rather than from when the worker started; the first run then deletes everything that expired in the meantime |
| Google Play refund sync | Runs, like a purge, only when none has finished in its current hour. A worker that was down longer than 30 days misses the refunds Google Play no longer lists |

The waiting interval is what keeps a restart or a deploy from being a sweep of every table and of the whole bucket.

## The outbox: mail, push, and cache revalidation

Every side effect a request leaves for later — a mail, a push notification, the drop of a cached page, an index update for the search engine — is written to the outbox in the same transaction as the change that caused it. So a change is never saved without its side effect, and the worker sends the entry within a few seconds.

An entry that fails is tried again, waiting twice as long after each failure: one second, then two, then four. After the tenth failed attempt, about nine minutes after the first, the entry is given up for good: it becomes **dead**, and nothing sends it again. An entry that can never succeed, such as a mail to an account that was deleted, is given up at once. What failing means depends on the entry:

- **Mail** fails while the SMTP server, or `email-renderer` once it is on, refuses or cannot be reached, as [Email](./6-email.md#the-mail-the-install-sends) describes.
- **A push notification** to a phone is skipped rather than failed while the tenant has no Firebase credentials saved, so it is not retried once they are. Browser notifications are sent only once Web Push is turned on, as [Web Push](./8-web-push.md) describes.
- **A cache revalidation** fails while a web app is down. A worker without `PUBLIRA_REVALIDATE_TOKEN` fails every drop `publira server` recorded, on every attempt; the drops of its own jobs it does not record at all, as [Free reading periods](#free-reading-periods-and-other-cached-pages) describes.

`PUBLIRA_OUTBOX_MAX_ATTEMPTS` on `publira worker` sets the number of attempts. The wait keeps doubling, up to an hour between attempts, so a few more attempts let an entry outlast a much longer outage.

### Seeing what was given up

The worker logs each entry it gives up on as `outbox event dead`, and counts it in the `publira.outbox.events.dead` metric when it exports OpenTelemetry metrics; alert on either. The entries themselves stay in the `outbox_events` table, with the last error:

```sql
SELECT event_type, tenant_id, attempts, last_error, updated_at
FROM outbox_events
WHERE status = 'dead'
ORDER BY updated_at DESC
LIMIT 20;
```

A dead entry cannot be sent again. What it costs depends on its `event_type`:

- **A mail** never arrives. A reader asks for a new password reset or confirmation mail, and an administrator invitation is resent, as [A tenant's staff](./3-tenant-staff.md) describes.
- **A push notification** never arrives, and the notification stays in the reader's list on the site and in the app.
- **A cache revalidation** leaves the pages it named showing what they showed before, until the next change to the same thing drops them again or their cache runs out.

## Running a job by hand

`publiractl job <job>` runs one pass of a maintenance job and exits. It runs the same code as the worker's scheduled pass, not a copy of it, so it behaves the way the scheduled pass does. It is for what the schedule does not do:

- **A backfill**: rebuilding the statistics of a named day the chain has already passed.
- **A dry run**: counting what a purge would delete before it deletes it.
- **Applying a change now**: a shorter retention period you just saved, purged now rather than at the next daily run.
- **Debugging** a pass that fails, with its log in front of you.

Run it with the image of the release the install runs, with `PUBLIRA_CONTENT_STATS_DB_URL` set to the `publira_content_stats` connection:

```bash
docker run --rm -e PUBLIRA_CONTENT_STATS_DB_URL \
  publira/publiractl:<tag> job purge-content-events
```

On a [Docker Compose](../2-deployments/3-docker-compose.md) install, `docker compose run --rm publiractl job purge-content-events` has the connection already. The image purge, the Google Play refund sync, and the search index build also need `PUBLIRA_SECRET_ENCRYPTION_KEYS` and `PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID` when the credential they use is saved in the install, as the bucket's access key, a tenant's Google Play service account key, or the search engine's password is.

A job logs to standard output, and exits `1` when the pass failed. A job that works through the tenants one at a time finishes the others before it exits, and its log names each tenant that failed.

### Dry runs

Every purge takes a variable that makes it count instead of delete, such as `PUBLIRA_CONTENT_EVENTS_PURGE_DRY_RUN=true` for `purge-content-events`; the name for each purge is in its reference. The count is in the log:

```bash
docker run --rm -e PUBLIRA_CONTENT_STATS_DB_URL \
  -e PUBLIRA_CONTENT_EVENTS_PURGE_DRY_RUN=true \
  publira/publiractl:<tag> job purge-content-events
```

A purge reads the retention periods when it starts, so a dry run counts what the periods saved now would delete. After saving a much shorter period, run one before the real run to see how much the purge will take with it. A dry run of `purge-orphan-images` reports the objects in the bucket that no image row names and that are at least a day old; after a [restore](../2-deployments/6-backup-and-restore.md#what-the-worker-catches-up-on), those include the images uploaded after the backup was taken.

### Rebuilding the statistics of a day

The chain never goes back over a day it has finished, so a day's statistics are not rebuilt again when the data behind them is corrected later. To rebuild one, after such a correction or when a release's notes ask for it, run the four links in their order, naming the day in the tenant's own calendar:

```bash
docker run --rm -e PUBLIRA_CONTENT_STATS_DB_URL \
  publira/publiractl:<tag> job project-episode-reads
docker run --rm -e PUBLIRA_CONTENT_STATS_DB_URL \
  -e PUBLIRA_CONTENT_STATS_DATE=2026-10-01 \
  publira/publiractl:<tag> job aggregate-content-stats
docker run --rm -e PUBLIRA_CONTENT_STATS_DB_URL \
  publira/publiractl:<tag> job aggregate-rankings
docker run --rm -e PUBLIRA_CONTENT_STATS_DB_URL \
  publira/publiractl:<tag> job build-recommend-features
```

A run rebuilds that day for every tenant. The rankings and the recommendations are rebuilt here for every tenant's yesterday, since the storefront only shows the newest leaderboard and the weekly one ending yesterday covers the last seven days; give them a date, with `PUBLIRA_CONTENT_RANKING_DATE` and `PUBLIRA_RECOMMEND_FEATURES_DATE`, only to rebuild an older leaderboard.

Do not rebuild a day whose analytics events have passed their content event retention period. The worker skips such a day, but a run by hand rebuilds it from what is left, and replaces the day's views, completed reads, and ratings with nothing ([#3785](https://github.com/publira/publira/issues/3785)).

A run by hand does not move the worker's record of how far each tenant has got, so the worker neither skips nor repeats a day because of it.

### Which jobs are safe to repeat

Every job can be run again, and alongside the worker's own pass of it:

| Job | Running it again |
| --- | --- |
| `project-episode-reads` | Writes nothing once every read is filed |
| `aggregate-content-stats`, `aggregate-rankings`, `build-recommend-features` | Replace what they built with the same result. Two runs of one of them for the same tenant and day wait for each other, and the second fails after 30 seconds rather than both writing |
| Every `purge-*` | Finds nothing left to delete |
| `close-royalty-statements` | Finds every owed month already closed. A first run closes for real only the months the next scheduled pass would close: those of tenants on **Close automatically** whose close day has come |
| `sync-google-play-voided-purchases` | Takes back nothing a second time |
| `build-search-index` | Does nothing when no build is due, or when the worker is already building |

The one exception is timing: do not run `purge-orphan-images` while a backup of the bucket is being copied, as [Backup and restore](../2-deployments/6-backup-and-restore.md#1-stop-the-worker) describes.

The publication, free reading period, day rollover, and pinned announcement jobs have no command of their own. To make them act, get the worker running.
