# publira

The binary behind both of a deployment's long-lived Go processes. The first argument names which one, and every setting comes from the environment:

| Command          | Process                                  |
| ---------------- | ---------------------------------------- |
| `publira server` | The API and image delivery, on one port  |
| `publira worker` | The Outbox drain and every scheduled job |

`publira server --with-worker` runs both in one process; see [Hosting the worker](#hosting-the-worker---with-worker). `publira server --role` serves some of its API surfaces alone; see [Serving some roles](#serving-some-roles---role). `publira worker --queue` hosts some of its queues alone; see [Hosting some queues](#hosting-some-queues---queue). Without a command, with a command other than these two, or with any further argument — `--role`, `--with-worker`, and `--queue` after `server`, and `--queue` after `worker`, aside — the binary prints its usage to stderr and exits with status 2. With the three Next.js apps, a deployment therefore runs five processes, and both Go ones come from one image ([`infra/docker/server/Dockerfile`](../../../infra/docker/server/Dockerfile)). [`publiractl`](../publiractl/README.md), the command an operator runs by hand, stays a binary of its own because it has to work on a deployment that serves nothing.

## publira server

One process serves all three Connect namespaces — `publira.v1`, `publira.admin.v1`, and `publira.platform.v1` — under `/rpc`, and image delivery under `/images`, on one listener, `PUBLIRA_PUBLIC_API_ADDR` (`:8000` when unset). It also answers `/livez` and `/readyz`, and registers nothing else at the root.

| Reached by | Through |
| --- | --- |
| The browser and the mobile app | The reverse proxy, which forwards `/images` and `publira.v1` under `/rpc`, with their prefixes kept, on every host |
| web-storefront, web-admin, and web-platform | The private network, each through its own `PUBLIRA_GRPC_URL`, which names `/rpc` on this listener, and web-admin through `PUBLIRA_PUBLIC_GRPC_URL` as well when it is set |

This process answers both consoles' namespaces, at `/rpc/publira.admin.v1.…` and `/rpc/publira.platform.v1.…`, on whatever host a request names, and a Connect handler answers gRPC, gRPC-Web, and the Connect protocol on one route. The edge is what keeps them off the internet: it forwards `/rpc/publira.v1.…` alone, since the consoles call their namespaces over the private network. Behind it, every console RPC refuses a caller without an operator session or the [web service credential](../../README.md#web-service-credential) before any handler runs, the ones that run before a session exists — signing in, password reset, and email verification — are rate-limited or guarded in the handler itself, and creating the Platform Console's first operator is refused without the web service credential, which only the Platform Console's server sends.

The process holds one pool per PostgreSQL login — `publira_public` and `publira_admin` under row-level security, `publira_platform` across every tenant — and picks the pool by the namespace a procedure path names. An image is answered on the pool of the login the host name selects: a `domain` match is the storefront, answered as `publira_public`, and an `admin_domain` match is the console, answered as `publira_admin`. The host also decides whether an `admin-media` token is evaluated as a staff preview and whether an episode body leaves encrypted. Each namespace reports its spans under its own `service.name`, and the image routes under `publira-image-server`, so the four stay apart in a trace UI.

`/readyz` names one check per pool — `db.public`, `db.admin`, `db.platform` — because a single `db` could not say which of the three logins stopped answering. The edge never forwards it.

### Running

From the repository root:

```bash
task server:dev-server
```

From the `server` directory:

```bash
go run ./cmd/publira server
```

Using a pre-built binary:

```bash
task server:build
./server/bin/publira server
```

Manael uses libvips, so building and running require `libvips-dev` (at runtime, `libvips42t64` on Debian 13, which renamed it from `libvips42` in its 64-bit `time_t` transition), and converting to AVIF requires an AVIF encoder plugin for libheif (`libheif-plugin-aomenc` on Debian 13); without one, a JPEG requested with an `Accept` that lists AVIF is answered with the original image. The Dev Container includes both. The production image is [`infra/docker/server/Dockerfile`](../../../infra/docker/server/Dockerfile).

### Main environment variables

- `PUBLIRA_PUBLIC_API_ADDR` (optional, `:8000` when unset. The one listener)
- `PUBLIRA_PUBLIC_DB_URL` / `PUBLIRA_ADMIN_DB_URL` / `PUBLIRA_PLATFORM_DB_URL` (optional; a development default is used when unset. One per login; the process never falls back from one to another, and image delivery and the search engine's settings use the first two. A process given [`--role`](#serving-some-roles---role) reads only its roles' ones)
- `PUBLIRA_PUBLIC_DB_REPLICA_URL` (optional, unset by default, read only where the `storefront` role is served. A hot standby of the database's cluster, signed in as `publira_public` like `PUBLIRA_PUBLIC_DB_URL`, which the catalog reads and the storefront's images that need no credential are answered on once it has replayed everything the primary had committed when the request arrived. A URL signing in as another login stops the process at startup. Unset, every read is made on `PUBLIRA_PUBLIC_DB_URL`. `/readyz` names it `db.public.replica`)
- `PUBLIRA_DB_MAX_OPEN_CONNS` / `PUBLIRA_DB_MAX_IDLE_CONNS` / `PUBLIRA_DB_CONN_MAX_IDLE_TIME` (optional, `10`, the first one's value, and `5m` when unset. Bound each of its pools on its own; see [Connection pools](../../README.md#connection-pools) for sizing the database)
- `PUBLIRA_AUTH_JWT_SECRET` (required, at least 32 bytes. The HS256 signing key for access tokens, which the image routes verify as well. The process fails to start when it is unset. For the details, see [Authentication](../../README.md#authentication-jwt-access-tokens) in the server README)
- `PUBLIRA_SECRET_ENCRYPTION_KEYS` / `PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID` (optional. Encrypt and decrypt the stored SMTP, payment, object store, search engine, and FCM secrets)
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` (optional. The ambient credential for an object store saved without an access key. The store itself comes from the platform's settings; see [Image storage configuration](../../README.md#image-storage-configuration))
- `PUBLIRA_REDIS_URL` (optional. Where the image conversion cache and the counters behind the reader write limits, the step-up password limit, and the mail limits are kept. Unset / `disabled` / `off` / `false` keeps the cache in memory and limits each instance on its own, which is looser than a shared limit by the number of instances. A `redis://` URL carrying a password stops the process at startup, because that scheme has no TLS: use `rediss://`)
- `PUBLIRA_IMAGE_CACHE_TTL` (optional. The TTL of a converted image. A Go duration or a number of seconds. Default `1h`. Read only where the `storefront` or the `admin` role is served)
- `PUBLIRA_REVALIDATE_TOKEN` (optional, the shared token sent in the `X-Revalidate-Token` header)
- `PUBLIRA_WEB_STOREFRONT_INTERNAL_URL` / `PUBLIRA_WEB_ADMIN_INTERNAL_URL` / `PUBLIRA_WEB_PLATFORM_INTERNAL_URL` (optional, the private network URL of each Next.js app `PUBLIRA_REVALIDATE_TOKEN` sends cache tags to. An app left unset is not sent anything; the token with none of them stops the process at startup)
- `PUBLIRA_WEB_SERVICE_TOKEN` (optional, read only where the `admin` or the `platform` role is served. The bearer the web apps call the tenant console's tenant-level reads and the Platform Console's platform-level reads with as themselves rather than as an operator. It is also what the Platform Console's setup screen creates the first operator with, and `CreateInitialUser` is refused without it. Unset, the admin and platform APIs accept operator sessions alone, and no first operator can be created. Logged at startup as `web service token is enabled` or `disabled`; see [Web service credential](../../README.md#web-service-credential))
- `PUBLIRA_TRUSTED_PROXIES` (optional. The addresses and CIDR ranges, separated by commas or spaces, of the proxies whose `Forwarded` and `X-Forwarded-For` entries are believed when finding the client address the sign-in log and the audit log record and the per-client limits count, and whose rightmost `host=` of `Forwarded`, or else rightmost `X-Forwarded-Host`, names the tenant an image request is for. From any other peer, the tenant is found from `Host` alone. Unset, the loopback, private, and link-local ranges; set, it replaces them. A value that is not an address or a range, or a range covering every address, stops the process at startup. See [The proxies Publira trusts](../../../docs/en/2-deployments/4-edge/index.md#the-proxies-publira-trusts))
- `PUBLIRA_FORWARDED_HEADER_ENABLED` (optional, `true` when unset. `false` reads the client address from `X-Forwarded-For` alone, and an image request's host from `X-Forwarded-Host` and `Host` alone, for proxies that pass on a `Forwarded` header the caller sent; otherwise `Forwarded` is read ahead of them. A value that is not a boolean stops the process at startup)
- `PUBLIRA_TENANT_URL_SCHEME` (optional, the scheme of every tenant host, set to the value `publira worker` runs with. Here it builds the storefront URL a payment provider returns the browser to, the origin the public API roots a tenant's image URLs at when the tenant has an image host, and the storefront origin that host allows)
- `PUBLIRA_STRIPE_API_URL` (optional, and unset in every deployment. Replaces the origin of Stripe's API for checkout and refunds, which is how the E2E stack has them call its stand-in for Stripe; `publira worker` reads it too. Read only where the `storefront` or the `admin` role is served; a value that is not an absolute `http` or `https` URL stops the process at startup)
- `PUBLIRA_LOG_FORMAT` (optional, `text` when unset. `text` writes each record as `key=value` pairs and `json` as one JSON object per line with the same keys; see [Logs](../../../docs/en/3-operations/11-monitoring.md#logs). Any other value stops the process at startup)
- `PUBLIRA_LOG_LEVEL` (optional, `info` when unset. The lowest level written: `debug`, `info`, `warn`, or `error`. The audit log's `audit` lines and the sign-in `audit auth` lines are written at `INFO` whatever it says. Any other value stops the process at startup)
- `PUBLIRA_TRACING_ENABLED` (optional, disabled by default. Enables OpenTelemetry tracing)
- `PUBLIRA_METRICS_ENABLED` (optional, disabled by default. Enables OpenTelemetry metrics, the audit log's among them; see [Metrics](../../README.md#metrics-opentelemetry))
- `PUBLIRA_DEPLOYMENT_ENVIRONMENT` (optional, `development` when unset. Determines `deployment.environment.name` and the default sampling rate)

The tenant-admin MFA requirement, the reader write limits, the step-up password limit, the mail limits, and the disposable email domain list are not environment variables: they are the platform policy, read and saved through `PlatformPolicyService` or `publiractl policy`, and a platform that has saved none gets the built-in defaults. A saved change reaches a running server within ten seconds.

The object store is read from the platform's settings on the pool of the surface that reads from it: the tenant console's uploads and its images on the admin pool, and the storefront's images and the readers' icon uploads on the public pool. Both logins are granted `platform_storage_config`, whose access key is sealed under keys only the process holds; see [Image storage configuration](../../README.md#image-storage-configuration). Both read the row again every 30 seconds, so a saved change reaches a running process without a restart, and the process starts before an operator has saved one: an upload until then is refused and an image answers `503`.

The catalog search engine is read from the platform's settings on the public pool, which the search RPCs are answered on, so the public API needs no other login to search; the engine's password in `platform_search_config` is sealed the same way. It is reread every 30 seconds: the search RPCs answer from the engine the row says the search is serving from, which trails a saved engine until the worker has built its index; see [Catalog search](../../README.md#catalog-search).

The trace attributes, span naming, sampling, and the list of `OTEL_*` variables are in [server/README.md](../../README.md#distributed-tracing-opentelemetry).

A write that leaves a cache entry stale records a `next_cache_revalidation` outbox event, in its own transaction where it holds one, and then attempts the drop itself without making the response wait for it. Whatever that attempt does not finish, `publira worker` retries. Both halves need `PUBLIRA_REVALIDATE_TOKEN`; without it nothing is recorded and nothing is sent. The destinations are the apps whose `PUBLIRA_WEB_*_INTERNAL_URL` is set, logged at startup as `next revalidate is enabled`, and the fixed path at each one is `/api/v1/revalidate`.

These internal URLs are private network addresses, not the ones browsers use: the URL a payment provider returns the browser to is built from the tenant's `domain`.

### Image delivery

After checking permissions, the image routes convert images to WebP / AVIF with Manael, resize them, cache the converted result, and return it. Conversion follows the request's `Accept` (`image/webp` / `image/avif`) and the `w` / `h` / `fit` / `q` query parameters. The key of the intermediate cache is derived from the same inputs, so one converted rendition is shared by every host name of a tenant; encryption is applied to the response afterwards and never to what is cached. On a hit the response header is `X-Publira-Image-Cache: hit`, and on a miss it is `miss`.

#### Authorization for episode body images

`GET /images/episodes/{media_id}` identifies the reader from `Authorization: Bearer <JWT>` (audience `public`) or from the `t=<JWT>` query (audience `media`), and treats a request carrying neither — or a credential that does not verify — as anonymous. Whichever it is, the grant itself is read from the database under the same rules as the API: `price = 0`, a valid purchase, or a valid access ticket. The media token is described in the package comment of [`internal/auth`](../../internal/auth/doc.go).

On a console host, a `t=<JWT>` of audience `admin-media` is evaluated as a preview for tenant staff on top of that reader-facing decision.

1. The user holds `tenant_admin` / `tenant_editor` / `tenant_auditor` in that tenant
2. The image belongs to an episode of that tenant
3. The token's `eid` matches that episode

The publication state and the price are not considered, so a draft, a scheduled, or a paid episode can still be checked from the admin UI's `<img>` / `next/image`. The tokens are appended to the URLs by `ListEpisodeImages` / `UploadEpisodeImages` / `ReorderEpisodeImages` / `DeleteEpisodeImage` / `ReplaceEpisodeImage`. On a storefront host the same audience unlocks nothing, so a console URL carried to a tenant site is an ordinary anonymous request.

`GET /images/episodes/{media_id}/preview` reads no credential: it serves a blurred, downscaled rendition of one of a published episode's opening pages to anyone, and `404` for any later page. See [Image delivery](../../README.md#image-delivery-manael).

### Platform console role permissions

| Operation | `platform_auditor` | `platform_operator` | `platform_super_admin` |
| --- | --- | --- | --- |
| Viewing the dashboard, tenants, users, audit logs, settings, and notifications | Yes | Yes | Yes |
| Changing tenants, tenant members, tenant administrator invitations, end users, SMTP, and platform settings | No | Yes | Yes |
| Creating, changing the role of, suspending, activating, and deactivating platform operators | No | No | Yes |
| Marking one's own notifications as read, signing out, and changing one's password and email address | Yes | Yes | Yes |

The server checks mutating RPCs in a shared interceptor, so a rejected call never starts a DB update, an audit log entry, or an email.

### Serving some roles (`--role`)

```bash
publira server --role storefront
publira server --role admin,platform
```

serves the named API surfaces alone. A role is named the way the web app that consumes it is, and a process serves exactly the namespaces, the image delivery, and the database login of the roles it was given; without the flag it serves all three. The flag decides what a process serves and nothing about ports or networks: every process listens on `PUBLIRA_PUBLIC_API_ADDR` alone.

| `--role` | Registers under `/rpc` | Image delivery on `/images` | Opens | Reads |
| --- | --- | --- | --- | --- |
| `storefront` | `publira.v1` | Storefront hosts and image hosts, as `publira_public` | `PUBLIRA_PUBLIC_DB_URL`, and `PUBLIRA_PUBLIC_DB_REPLICA_URL` when it is set | `PUBLIRA_IMAGE_CACHE_TTL` |
| `admin` | `publira.admin.v1` | Console hosts, as `publira_admin`, staff preview included | `PUBLIRA_ADMIN_DB_URL` | `PUBLIRA_WEB_SERVICE_TOKEN`, `PUBLIRA_IMAGE_CACHE_TTL` |
| `platform` | `publira.platform.v1` | None | `PUBLIRA_PLATFORM_DB_URL` | `PUBLIRA_WEB_SERVICE_TOKEN` |

Roles combine with a comma, or with the flag given again. A role opens its own pool and no other, and a variable only one role reads is not read without that role; the sign-in providers' key URLs, which the public API alone verifies ID tokens with, are read only with `storefront`. `/images` is registered when `storefront` or `admin` is served, and a host of a site whose role the process does not serve is answered `404` rather than as the other site's login, so a `storefront` process never honours a staff preview. `/readyz` names one check per pool the process holds, and the spans report under the names of the namespaces it serves. An unknown role, an empty one, or a role named twice prints the usage and exits with status 2, and `--with-worker` combines with any set of roles.

The process the reverse proxy forwards internet traffic to can therefore run `--role storefront`: it holds `publira_public` alone, serves neither console's API, and takes no web service token. web-storefront, which calls `publira.v1` alone, is pointed at it as well. Another process without the flag can keep serving web-admin and web-platform through their `PUBLIRA_GRPC_URL`, and the edge forwards a console host's public API and `/images` to it: the images a console page shows are the `admin` role's, and a `storefront` process answers them `404`.

That other process can run `--role admin,platform` instead. `web-admin` calls `publira.v1` for the tenant's theme and tags as well as `publira.admin.v1`, so it is then given the storefront process for the first in [`PUBLIRA_PUBLIC_GRPC_URL`](../../../apps/web-admin/README.md#api-connection) and this one for the second in `PUBLIRA_GRPC_URL`. The edge forwards a console host's public API to the storefront process, which answers `publira.v1` on any host, and keeps a console host's `/images` on this one.

### Hosting the worker (`--with-worker`)

```bash
publira server --with-worker
```

runs everything [`publira worker`](#publira-worker) runs inside this process as well, for an install on one host that will not scale the two apart: the Go side becomes one container, or one systemd unit, instead of two. The flag chooses what the process hosts, and every value still comes from the environment. [`--queue`](#hosting-some-queues---queue) narrows the worker it hosts as it narrows `publira worker`, and is refused without `--with-worker`. The image's default command stays `server`; [`infra/deploy/compose.yaml`](../../../infra/deploy/compose.yaml) runs its `server` service with the flag.

Nothing is merged. The process holds all six pools, one per login, or fewer when `--role` or `--queue` narrows either half, and serves both listeners — the server's `:8000` and the worker's `:8003` — each with the `/livez` and `/readyz` it answers with in a process of its own, so an orchestrator's probes and the reverse proxy's routing are unchanged. It therefore reads the union of both processes' environment variables: the ones [above](#main-environment-variables) and the ones [under the worker](#main-environment-variables-1). The process does not start when either half cannot, just as that half does not start on its own. One `SIGTERM` stops the whole process within the same 30-second window either process takes alone.

Every `service.name` of both processes is kept: the Connect namespaces, the image routes, `publira-worker` for the Outbox drain, and one per job. The process default is `publira-api-server`, so the metrics — the Outbox instruments among them — and the database and outbound HTTP spans that belong to no namespace or job report under that name.

The trade-off is the process boundary. Two processes can be scaled independently; one cannot, and adding a replica adds both. And the process the reverse proxy forwards internet traffic to also holds the worker's logins, `publira_outbox` among them, which owns River's schema and holds `CREATE` on the `public` schema. Run the two apart when either matters to the install: to scale them separately, or to keep the worker's logins out of the process the edge forwards to.

## publira worker

The long-lived background process. It hosts one River client, on which it drains the Outbox and processes the entries as jobs, runs the [periodic jobs](#periodic-jobs), and owns the [maintenance jobs](#maintenance-jobs) that rebuild, purge, close, and reconcile stored data. It runs as a separate process from `publira server`, and it is all the scheduling a deployment needs: nothing besides it — no host cron, no Kubernetes CronJob — has to invoke a job on a timer. Any number of replicas may run, since every scheduled job is unique while a run of it is in flight, and a replica may host some of the work alone; see [Hosting some queues](#hosting-some-queues---queue). Besides `outbox_test`, the Outbox drain handles these email events:

| Event type | Mail |
| --- | --- |
| `tenant_admin_invitation_email` | Tenant administrator invitation |
| `platform_password_reset_email` | Platform Console password reset, or the link that sets the first password of an operator a Super admin added |
| `platform_email_change_confirmation_email` | Platform Console email change confirmation, one event per address to confirm |
| `platform_email_changed_notice_email` | Platform Console notice to the previous address once the change completes |
| `platform_operator_role_granted_email` | Platform Console notice to an existing account a Super admin gave a role, saying it can now sign in |
| `reader_email_verification_email` | Reader sign-up address verification |
| `reader_email_change_confirmation_email` | Reader email change confirmation, one event per address to confirm |
| `reader_email_changed_notice_email` | Reader notice to the previous address once the change completes |
| `reader_password_reset_email` | Reader password reset |
| `reader_password_changed_notice_email` | Reader notice that the password on the account was changed |
| `reader_signup_attempt_notice_email` | Reader notice that a sign-up was attempted with an address that already has an account |
| `purchase_receipt` | Reader receipt for a purchase recorded from a payment provider's notification, one per purchase however often the notification is redelivered |
| `admin_password_reset_email` | Admin console password reset |
| `admin_email_change_confirmation_email` | Admin console email change confirmation, one event per address to confirm |
| `admin_email_changed_notice_email` | Admin console notice to the previous address once the change completes |

It also handles these non-mail events:

| Event type | Side effect |
| --- | --- |
| `member_push_notification` | The FCM or Web Push delivery that mirrors a member's `notifications` row, one message per registered device |
| `comment_awaiting_approval_notification` | A `notifications` row for every member of the tenant's staff, saying that one episode has comments waiting in the approval queue |
| `comment_reported_notification` | The same, for an episode whose comments readers have reported |
| `announcement_notification` | A `notifications` row for every user of the tenant, saying that one announcement was posted |
| `targeted_announcement_notification` | The same, for an announcement with an audience: a row for each user the audience selects when the event is handled |
| `episode_published_notification` | The `notifications` rows, and the `member_push_notification` that mirrors them, for the followers of an episode the admin console published as it created it; an episode the scheduled publication job publishes has them written by that job |
| `comment_approved_notification` | The `notifications` row telling a reader that staff approved their comment |
| `next_cache_revalidation` | The `POST /api/v1/revalidate` to each `web-*` app that drops the cache tags one write left stale |
| `catalog_index_sync` | The OpenSearch document of one series, creator, or label, rewritten from the row, or replaced with a tombstone no search finds when the row is published nowhere, and, once a search can find the write, a `next_cache_revalidation` for the storefront's searches of that kind. Nothing on the `sql` search backend |
| `reader_signup_request` | A sign-up the storefront accepted: the inactive account, its consents, and a `reader_email_verification_email` for a free address, or a `reader_signup_attempt_notice_email` for a registered one |
| `reader_password_reset_request` | A password reset the storefront accepted: the reset token and a `reader_password_reset_email` when the address has an account |
| `reader_email_verification_request` | A verification resend the storefront accepted: a fresh token and a `reader_email_verification_email` when the address has an unconfirmed account |
| `admin_password_reset_request` | A password reset the admin console accepted: the reset token and an `admin_password_reset_email` when the address has an account in the tenant |
| `platform_password_reset_request` | A password reset the platform console accepted, or an operator a Super admin added: the reset token and a `platform_password_reset_email` when the address belongs to an operator |
| `google_play_purchase_consume` | The Google Play Developer API consume of a Play purchase `ConfirmStorePurchase` recorded, which also acknowledges it |
| `subscription_cancel` | The immediate cancellation, on the tenant's Stripe account, of a subscription whose reader's account was deleted. While the tenant's payment settings cannot send it, it is tried again every 10 minutes without spending an attempt, so `PUBLIRA_OUTBOX_MAX_ATTEMPTS` does not mark it `dead`; see [Subscription plans](../../README.md#subscription-plans) |

The push handler is always registered and reads its credentials per delivery: a mobile device is sent with its tenant's stored FCM credentials and skipped while the tenant has none, and a browser with the platform's VAPID key pair; see [Mobile push](../../README.md#mobile-push-firebase-cloud-messaging) and [Web Push](../../README.md#web-push).

Both comment events are keyed by the episode and the hour they arrived in, so an episode a hundred readers comment on within the hour produces one alert rather than a hundred. The window is held by `outbox_events.idempotency_key`, which is why a burst writes a single row here, and by the notification's own `(user_id, notification_type, subject_key)`, which is why a redelivered event writes no second row for anyone.

The platform console rows carry no `tenant_id`: their handlers resolve the platform SMTP settings and the platform default locale and time zone rather than a tenant's. The reader and admin console rows name a tenant: the reader links point at that tenant's own domain, and the admin console links at its admin domain.

### What a mail is made of

Every mail's subject line and plain-text body are composed here, out of `locales/*.json`. `PUBLIRA_EMAIL_RENDERER_URL` decides the rest, and a deployment gets one of exactly two mails:

| `PUBLIRA_EMAIL_RENDERER_URL` | What is delivered |
| --- | --- |
| Set | A `multipart/alternative` message whose HTML part is the email-renderer's output |
| Unset | A `text/plain` message, and no call to the renderer |

There is no default URL. A deployment that does not run the renderer sends readable mail rather than retrying every mail event until the row goes `dead`, and a renderer that is configured but down or answering with no HTML is a failed attempt the worker repeats — never a mail silently downgraded to text.

### Periodic jobs

Some jobs have to act the moment a stored instant passes rather than on a schedule someone invokes, so River enqueues them on an interval and this process runs them:

| Kind | Interval variable | What it does |
| --- | --- | --- |
| `ticker.publish_episodes` | `PUBLIRA_PUBLISH_INTERVAL_SECONDS` | Promotes every episode whose scheduled time has passed |
| `ticker.apply_free_windows` | `PUBLIRA_FREE_WINDOW_INTERVAL_SECONDS` | Records the drop of the public site caches at both ends of every scheduled episode free window |
| `ticker.roll_tenant_day` | `PUBLIRA_TENANT_DAY_INTERVAL_SECONDS` | Records the drop of the cache entries whose answer is a tenant's own calendar day, at that tenant's midnight |
| `ticker.expire_pinned_announcements` | `PUBLIRA_PINNED_ANNOUNCEMENT_INTERVAL_SECONDS` | Clears `announcements.pinned` once `pinned_until` has passed, and records the drop of the tag the site holds its banner under |
| `ticker.apply_series_publications` | `PUBLIRA_SERIES_PUBLICATION_INTERVAL_SECONDS` | Records the drop of the public site caches for every series whose scheduled publication time has passed |
| `ticker.apply_campaign_banners` | `PUBLIRA_CAMPAIGN_BANNER_INTERVAL_SECONDS` | Records the drop of the tag the site holds its campaign banners under, at both ends of every published banner's window |
| `ticker.apply_campaign_prices` | `PUBLIRA_CAMPAIGN_PRICE_INTERVAL_SECONDS` | Records the drop of the public site caches that quote an episode's price, at both ends of every scheduled campaign price |
| `ticker.expire_coin_grants` | `PUBLIRA_COIN_EXPIRY_INTERVAL_SECONDS` | Records an expiry in the reader's coin history for every grant of coins that expired with coins unspent, and zeroes what the grant has left |
| `ticker.apply_free_after_rules` | `PUBLIRA_FREE_AFTER_INTERVAL_SECONDS` | Brings the free windows of each enabled `series_free_after_settings` rule in line with it — writing the window an episode has reached, and removing the window of one the rule no longer covers — and records the drop of the public site caches for a window that is open or was |

They run on a River queue of their own (`ticker`, one worker each) rather than the default one the Outbox drain is sized for: one pass is long and rare where an outbox job is short and constant, so a publish walking every tenant with retries must not hold a worker the drain is counting on.

Each runs once when the client starts and then once per interval, so a deployment that was down over a scheduled time, a window boundary, or a midnight catches up as soon as it comes back. Each is unique over River's in-flight states, so a second instance of this worker enqueues no second copy and a pass that outlasts its own interval is not started again underneath itself. A due run is a `river_job` row, which is where to look for one rather than in a process's log.

A window needs no job to take effect in the API: the access predicates compare the stored period against the current instant, so an episode inside a free window answers as free from the moment it opens. What the job fixes is what the web apps cached before that. Each end of a window is recorded once its drop is owed — a `next_cache_revalidation` row this worker then sends — so a boundary crossed while this process was down is applied on the next pass instead of leaving the site on the side of the window it has left.

Which midnight `ticker.roll_tenant_day` answers to is the tenant's, resolved from `tenants.timezone` (falling back to `platform_config.default_timezone`), so one pass turns over a tenant in Tokyo hours before one in Los Angeles. The tag is `tenant:<id>:today`, and only the storefront's weekly schedule carries it. Which day each tenant was last rolled on is remembered in the process rather than in a column: a drop is idempotent, so a restart costs one extra drop of one narrow tag per tenant, which is why the first pass after startup turns every tenant over.

A pinned announcement needs no job to stop being answered either: the banner read compares `pinned_until` against the current instant. What the job fixes is the band a site cached, and clearing the flag is what records the boundary as applied, so a window that closed while this process was down is taken down on the next pass. The flag is cleared once the drop is owed, for the reason the free window's boundary is. The tag is `tenant:<id>:announcements:pinned`, which only the banner carries; the console drops the same tag when an operator pins or unpins one.

They connect as `publira_ticker` rather than on the pool above. The worker's own login owns River's schema and therefore holds `CREATE` on the `public` schema, which is the one privilege these jobs must not have.

### Maintenance jobs

The rebuild, purge, royalty close, and search index work runs here as well, on the same River client:

| Kind | What it does |
| --- | --- |
| `maintenance.project_episode_reads` | Files the missing `episode_complete` events for stored `episode_reads` |
| `maintenance.aggregate_content_stats` | Rebuilds each day of `content_daily_stats` a tenant is owed |
| `maintenance.aggregate_rankings` | Rebuilds the daily and weekly `content_ranking_snapshots`, tenant-wide and per genre, with the series ones per surface and the tenant-wide series ones per age rating, of each day a tenant is owed |
| `maintenance.build_recommend_features` | Rebuilds the user and item recommend feature snapshots |
| `maintenance.purge_content_events` | Deletes `content_events` rows past their retention window |
| `maintenance.purge_ranking_snapshots` | Deletes `content_ranking_snapshots` rows past their retention window |
| `maintenance.purge_mfa_challenges` | Deletes the spent MFA challenges whose tokens have expired, and the passkey ceremonies left unfinished past their expiry |
| `maintenance.purge_withdrawn_comments` | Deletes the comments their authors withdrew past the retention window |
| `maintenance.purge_orphan_images` | Deletes the image rows and storage objects nothing references |
| `maintenance.close_royalty_statements` | Closes the royalty statements the tenants on automatic closing are owed |
| `maintenance.sync_google_play_voided_purchases` | Takes back the purchases Google Play refunded |
| `maintenance.build_search_index` | Builds the catalog index on the saved search engine, when the search does not answer from it yet, and moves the search onto it |

Each kind is a thin wrapper around `internal/maintenance`, which is the same implementation [`publiractl job`](../publiractl/README.md) invokes for an explicit operator run — a backfill of a named date, a recovery after an incident, a dry-run purge. A pass only the schedule could reach would be a second copy of the maintenance, free to diverge from the one an operator recovers with.

The first four are one chain, in this order, and only its head is scheduled: `maintenance.project_episode_reads` runs when the client starts and then once an hour, and each link enqueues the next when its pass ends. Hourly is how soon a tenant's day is rebuilt after it ends, since each tenant's midnight falls on a different hour.

How far the chain has got is recorded per tenant in `daily_rebuild_progress`, in that tenant's own calendar days:

| Link | Rebuilds, for each tenant |
| --- | --- |
| `maintenance.project_episode_reads` | Every pending read, then records when the pass began. A tenant the table has no row for starts its chain on its own yesterday |
| `maintenance.aggregate_content_stats` | Each day after `content_stats_through` whose end came before that recorded instant, so no read finished on it is filed after its stats. A day that began before the tenant's content event retention cutoff has lost its events, so it is logged as missing and passed over rather than rebuilt from what is left |
| `maintenance.aggregate_rankings` | Each day after `rankings_through`, up to `content_stats_through` |
| `maintenance.build_recommend_features` | The day at `rankings_through`, once it has moved past `recommend_features_through`. The feature tables hold one snapshot per tenant, so the days in between are not built |

So a worker that was down for days rebuilds each of them on its return, in order, and a link never reads a day the one before it has not finished. A day that fails stops that tenant's progress there: the other tenants carry on, the job is recorded as failed and retried, and the next pass starts again on the day that failed rather than after it. A run of [`publiractl job`](../publiractl/README.md) neither reads nor moves this record.

Each purge is scheduled on its own, runs when the client starts, and then once per interval:

| Kind                                   | Interval |
| -------------------------------------- | -------- |
| `maintenance.purge_content_events`     | 24 hours |
| `maintenance.purge_ranking_snapshots`  | 24 hours |
| `maintenance.purge_mfa_challenges`     | 1 hour   |
| `maintenance.purge_withdrawn_comments` | 1 hour   |
| `maintenance.purge_orphan_images`      | 24 hours |

A purge needs no record of what it missed: one pass deletes everything past its cutoff at the moment it runs, so the first pass after downtime drains every row that expired in the meantime. Each is also unique over a run that completed in its current interval, counted from the epoch rather than from the process start, so a restart runs a purge only when none has finished in that interval yet — which is what keeps a deploy from being a sweep of the whole bucket. A pass that failed for good does not count, and the next restart or interval tries again.

`maintenance.close_royalty_statements` is scheduled on its own too: it runs when the client starts and then once an hour, which is how soon a tenant's close day is reached after its local midnight. It needs no record of what it missed either. A pass closes every month a tenant owes, from the month the tenant chose automatic closing through the latest month whose close day has come, so a close day the worker was down for is closed on its return, and a month already closed, by hand or by an earlier pass, is left as it is. Like the chain, it keeps no completed run as a reason to skip one.

`maintenance.sync_google_play_voided_purchases` runs when the client starts and then once an hour, which is at most how long a refunded Play purchase keeps opening its episode. Each pass reads the 30 days Google Play's Voided Purchases API keeps, for every tenant whose Google Play store is enabled and names its app, and writes what it finds idempotently, so it needs no record of what it missed as long as the worker is back within those 30 days. Because every pass rereads the same window, it is unique over a run completed in its current interval, as a purge is.

`maintenance.build_search_index` runs when the client starts and then every 30 seconds, the interval every process rereads the search settings on, so an engine saved through the Platform Console or `publiractl search set` is built within that much of the save. A pass with nothing due reads one row and ends; one that has a build due fills a new index from the database and moves the search onto it, and one whose build fails records the failure on the row and leaves the next pass to try again. It runs on a queue of its own (`search_index`, one worker), so a saved engine does not wait behind an hour of daily rebuilds and a long build does not hold them back, and it takes a lock `publiractl search reindex` takes too, so two builds never fill the same alias at once.

The rest run on a queue of their own (`maintenance`) for the reason the ticker jobs do, and then some: a rebuild walks every tenant and a purge deletes in chunks until a table is drained. The queue runs one pass at a time across the whole install, because these share one database with every request the platform is serving: each replica's queue takes one pass at a time, and a pass also holds a PostgreSQL advisory lock for as long as it runs, so a pass another replica picks up meanwhile is snoozed until the lock is free. A snooze spends none of the pass's attempts. `maintenance.build_search_index` is on its own queue and takes no part in this. Each kind is unique over River's in-flight states, so a second instance of this worker enqueues no second copy, and a failed pass is retried three times rather than dropped: every one of them is idempotent, so a pass lost to a connection drop is worth running again.

They connect as `publira_content_stats`, the role the batch subcommands have always used for this work, on a third pool. What the work may reach is decided by the role, and hosting three kinds of job in one process is not a reason for any of them to borrow another's privileges.

`maintenance.purge_orphan_images` is the one that reaches past the database. It sweeps the bucket saved in the platform's settings, resolved when a run starts, so the worker starts before one is saved; a run on a platform with none is cancelled with that reason rather than retried.

### Running

From the repository root:

```bash
task server:dev-worker
```

From the `server` directory:

```bash
go run ./cmd/publira worker
```

Using a pre-built binary:

```bash
task server:build
./server/bin/publira worker
```

The production image is the same one `publira server` runs on, with `worker` as the container argument:

```bash
task docker:build:server
docker run --rm publira/publira:local worker
```

### Main environment variables

The connection uses `publira_outbox`, the login across every tenant the baseline seed creates for this process, in every environment. `PUBLIRA_DB_URL` is not a fallback: it is the superuser connection locally and the migration tooling's connection in production, so an unset variable fails to authenticate rather than quietly granting the worker more privilege.

- `PUBLIRA_WORKER_DB_URL` (optional; falls back to the development default `postgres://publira_outbox:outboxpass@db:5432/publira?sslmode=disable`)
- `PUBLIRA_TICKER_DB_URL` (optional; the periodic jobs' own connection, falling back to `postgres://publira_ticker:tickerpass@db:5432/publira?sslmode=disable` and never to `PUBLIRA_DB_URL`. Read only where the `ticker` queue is hosted)
- `PUBLIRA_CONTENT_STATS_DB_URL` (optional; the maintenance jobs' own connection, falling back to `postgres://publira_content_stats:contentstatspass@db:5432/publira?sslmode=disable` and never to `PUBLIRA_DB_URL`. Read only where the `maintenance` or the `search_index` queue is hosted)
- `PUBLIRA_CONTENT_STATS_DB_REPLICA_URL` (optional, unset by default, read only where the `maintenance` queue is hosted. A hot standby of the database's cluster, signed in as `publira_content_stats` like `PUBLIRA_CONTENT_STATS_DB_URL`, which the content stats rebuild and the recommend feature build read `content_events` on, a tenant at a time, once it has replayed everything the primary had committed when that tenant's rebuild began. A standby still behind after 5 seconds leaves that tenant's read to the primary. Every write, and every other job's read, stays on `PUBLIRA_CONTENT_STATS_DB_URL`. A URL signing in as another login stops the process at startup. `/readyz` names it `db.content_stats.replica`)
- `PUBLIRA_DB_MAX_OPEN_CONNS` / `PUBLIRA_DB_MAX_IDLE_CONNS` / `PUBLIRA_DB_CONN_MAX_IDLE_TIME` (optional, `10`, the first one's value, and `5m` when unset. Bound each of the pools on its own, as in `publira server`; see [Connection pools](../../README.md#connection-pools))
- `PUBLIRA_WORKER_ADDR` (optional, default `:8003`. Serves `/livez` and `/readyz`)
- `PUBLIRA_OUTBOX_DRAIN_INTERVAL` (optional, a Go duration. Default `2s`)
- `PUBLIRA_OUTBOX_CLAIM_LIMIT` (optional, the maximum number of rows claimed per drain. Default `100`)
- `PUBLIRA_OUTBOX_MAX_ATTEMPTS` (optional, default `10`. The failure count at which an entry becomes `dead`)
- `PUBLIRA_OUTBOX_STALE_PROCESSING` (optional, a Go duration. Default `15m`. A `processing` row older than this is returned to `pending`. For the auth mail above the reclaim also counts as a failed attempt, so this duration times `PUBLIRA_OUTBOX_MAX_ATTEMPTS` bounds how long a crash loop can keep the row's raw token)
- `PUBLIRA_OUTBOX_MAX_WORKERS` (optional, the concurrency of River's default queue, which the Outbox drain has to itself. Default `8`)
- `PUBLIRA_PUBLISH_INTERVAL_SECONDS` / `PUBLIRA_FREE_WINDOW_INTERVAL_SECONDS` / `PUBLIRA_TENANT_DAY_INTERVAL_SECONDS` / `PUBLIRA_PINNED_ANNOUNCEMENT_INTERVAL_SECONDS` / `PUBLIRA_SERIES_PUBLICATION_INTERVAL_SECONDS` / `PUBLIRA_CAMPAIGN_BANNER_INTERVAL_SECONDS` / `PUBLIRA_CAMPAIGN_PRICE_INTERVAL_SECONDS` / `PUBLIRA_COIN_EXPIRY_INTERVAL_SECONDS` / `PUBLIRA_FREE_AFTER_INTERVAL_SECONDS` (optional, seconds between the passes of each periodic job. Default `60`; a non-numeric or non-positive value falls back to it. Each one bounds how long the site can stay on the wrong side of the instant its job answers to)
- `PUBLIRA_PUBLISH_MAX_RETRIES` (optional, retries per episode within one `ticker.publish_episodes` pass. Default `3`. Read only where the `ticker` queue is hosted)
- `PUBLIRA_EPISODE_READ_PROJECTION_BATCH_SIZE`, `PUBLIRA_CONTENT_RANKING_ITEM_LIMIT`, `PUBLIRA_RECOMMEND_FEATURES_WINDOW_DAYS`, `PUBLIRA_CONTENT_EVENTS_PURGE_CHUNK_SIZE`, `PUBLIRA_CONTENT_RANKING_PURGE_CHUNK_SIZE`, `PUBLIRA_MFA_CHALLENGE_PURGE_CHUNK_SIZE`, `PUBLIRA_COMMENT_PURGE_CHUNK_SIZE`, `PUBLIRA_ORPHAN_IMAGES_MIN_AGE_HOURS`, `PUBLIRA_ORPHAN_IMAGES_PAGE_SIZE` (optional, the maintenance jobs' tunables, documented per job in [publiractl](../publiractl/README.md). They are read once at startup, where the `maintenance` or the `search_index` queue is hosted, so a value that is not a positive whole number stops the process with the variable's name. The dated rebuild and dry-run variables are not read here: they control one invocation rather than a deployment, so they belong to `publiractl job`)
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` (optional, the ambient credential `maintenance.purge_orphan_images` signs with when the platform's object store is saved without an access key)
- `PUBLIRA_EMAIL_RENDERER_URL` (optional, the URL of the email-renderer that renders the HTML part of the emails above. Unset, the mail goes out as text alone; see [What a mail is made of](#what-a-mail-is-made-of))
- `PUBLIRA_REVALIDATE_TOKEN`, `PUBLIRA_WEB_STOREFRONT_INTERNAL_URL`, `PUBLIRA_WEB_ADMIN_INTERNAL_URL`, `PUBLIRA_WEB_PLATFORM_INTERNAL_URL` (optional, where `next_cache_revalidation` sends cache tags: `POST /api/v1/revalidate` on each `web-*` app whose URL is set, as `publira server` does. A worker without the token retries every such event until an operator restarts it with one, because the drop is owed whoever wrote it)
- `PUBLIRA_PLATFORM_APP_URL` (optional, the base URL the Platform Console links in the platform auth mail are built from. `http://platform.localhost:3080` when unset)
- `PUBLIRA_STRIPE_API_URL` (optional, and unset in every deployment. Replaces the origin of Stripe's API for `subscription_cancel`, as in `publira server`. Read only where the `outbox` queue is hosted; a value that is not an absolute `http` or `https` URL stops the process at startup)
- `PUBLIRA_TENANT_URL_SCHEME` (optional, the scheme the links in the reader and tenant console mail are built on, joined to the tenant's `domain` or `admin_domain`. `https` when unset. A value that is neither `http` nor `https` leaves the mail pending until the worker is restarted with a valid one)
- `PUBLIRA_SECRET_ENCRYPTION_KEYS` / `PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID` (optional, the keys used to decrypt the SMTP password, the object store's access key, the search engine's password, the Web Push VAPID private key, and each tenant's FCM service account key. Set the same values as the platform API. Push takes no variable of its own: mobile push is sent with each tenant's stored FCM credentials, see [Mobile push](../../README.md#mobile-push-firebase-cloud-messaging), and Web Push with the platform's stored VAPID key pair once an operator has saved a subject, see [Web Push](../../README.md#web-push))
- `PUBLIRA_LOG_FORMAT` / `PUBLIRA_LOG_LEVEL` (optional, as in `publira server`)
- `PUBLIRA_TRACING_ENABLED` (optional, disabled by default)
- `PUBLIRA_METRICS_ENABLED` (optional, disabled by default. Enables the OpenTelemetry metrics below)
- `PUBLIRA_DEPLOYMENT_ENVIRONMENT` (optional, `development` when unset)

The trace attributes, span naming, sampling, and the list of `OTEL_*` variables are in [server/README.md](../../README.md#distributed-tracing-opentelemetry).

River's schema (`river_job` and the rest) is applied with `rivermigrate` at startup, which is why `publira_outbox` holds `CREATE` on the `public` schema. `/readyz` names one check per pool the process holds — `db.outbox`, `db.ticker`, and `db.content_stats` without [`--queue`](#hosting-some-queues---queue) — so a failure says which login stopped answering.

### Hosting some queues (`--queue`)

```bash
publira worker --queue outbox
publira worker --queue ticker,maintenance,search_index
```

hosts the named River queues alone. Every replica otherwise runs every kind of work, so the replica that picks up an hour-long rebuild is also one of the replicas sending mail; with the flag, the Outbox drain gets replicas of its own, sized apart from the ones that run the maintenance passes. Without the flag a replica hosts all four.

| `--queue` | River queue | Runs | Opens | Reads |
| --- | --- | --- | --- | --- |
| `outbox` | `default` | The Outbox drain: mail, push, cache revalidation, search index sync | `PUBLIRA_WORKER_DB_URL` |  |
| `ticker` | `ticker` | The [periodic jobs](#periodic-jobs) | `PUBLIRA_WORKER_DB_URL`, `PUBLIRA_TICKER_DB_URL` | `PUBLIRA_PUBLISH_MAX_RETRIES` |
| `maintenance` | `maintenance` | Every [maintenance job](#maintenance-jobs) but the search index build | `PUBLIRA_WORKER_DB_URL`, `PUBLIRA_CONTENT_STATS_DB_URL`, and `PUBLIRA_CONTENT_STATS_DB_REPLICA_URL` when it is set | The maintenance jobs' tunables |
| `search_index` | `search_index` | `maintenance.build_search_index` | `PUBLIRA_WORKER_DB_URL`, `PUBLIRA_CONTENT_STATS_DB_URL` | The maintenance jobs' tunables |

Queues combine with a comma, or with the flag given again. Every queue opens `publira_outbox`, which the River client itself connects as, and a queue opens the pool its jobs connect as besides it; a variable only one queue reads is not read without that queue, and `/readyz` names the pools the process holds alone. An unknown queue, an empty one, or a queue named twice prints the usage and exits with status 2.

Every queue needs at least one replica that hosts it. The periodic jobs are enqueued by whichever replica River elects leader, whatever queues it hosts itself, so a job whose queue no running replica hosts is not dropped: it waits in `river_job`, in state `available`, until a replica that hosts its queue starts. The leader also rescues the jobs a stopped replica left running, on every queue, so a pass cut off on a replica that hosts its queue is retried whichever replica leads. A replica that leaves some queues to others logs which at startup, as `worker leaves queues to other replicas` with `not_hosted` naming them. For the same reason every replica reads the interval variables of every periodic job and the Outbox drain's, so give every replica the same values.

### Logs and metrics

OpenTelemetry reports `service.name` as `publira-worker` for the process, and a name of its own for the span each job's run hangs off: `publira-publish-episodes`, `publira-apply-free-windows`, `publira-roll-tenant-day`, `publira-expire-pinned-announcements`, `publira-apply-series-publications`, `publira-apply-campaign-banners`, `publira-apply-campaign-prices`, `publira-expire-coin-grants`, or `publira-apply-free-after-rules` for a periodic run, and `publira-<subcommand>` for a maintenance run — `publira-aggregate-content-stats` and the rest. They are the names those jobs report when `publiractl job` runs them by hand, so a trace UI filtering on one keeps finding the same work.

The structured logs (slog) of the Outbox drain carry `event_id` / `event_type` / `idempotency_key` / `attempts`. Those of a maintenance run carry `job_kind` / `job_id` / `attempt`, and its span carries `river.job.id` / `river.job.attempt` and an error status when the pass fails, so a failure found in either leads to its `river_job` row: the `errors` column there holds every failed attempt's error, naming the tenant and the day it stopped on. The OpenTelemetry instruments, each carrying `outbox.event_type`, are:

- `publira.outbox.events.claimed` (counter: rows claimed from `pending`)
- `publira.outbox.events.done` (counter)
- `publira.outbox.events.retry` (counter: rows returned to `pending` after a failure)
- `publira.outbox.events.resumed` (counter: rows returned to `pending` by a handler that made progress and has more to do)
- `publira.outbox.events.dead` (counter)
- `publira.outbox.handler.duration` (histogram, seconds)

They are exported once `PUBLIRA_METRICS_ENABLED` is set; the exporter variables are in [server/README.md](../../README.md#metrics-opentelemetry).

### Processing flow

1. Claim due `pending` rows with `FOR UPDATE SKIP LOCKED` and enqueue the River jobs in the same transaction
2. The job runs the handler: `done` on success, or back to `pending` with exponential backoff on failure
3. An event whose type the worker has no handler for goes back to `pending` without spending an attempt, due again a minute later, for a worker of a newer release to claim; one still unknown a day after it was written is `dead`
4. `dead` on reaching the maximum attempt count or on a permanent error
5. After a process restart, unprocessed `pending` rows and stale `processing` rows are picked up again. A crash records no failure, so for the auth mail above the reclaim spends an attempt: a worker dying on every attempt eventually reaches `dead`, where the raw token is dropped from `payload`
