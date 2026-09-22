# image-server

The image delivery server. After checking permissions, it converts images to WebP / AVIF with Manael, resizes them, caches the converted result, and returns it.

One process serves both of a tenant's host names. Which of the two a request arrived on is the tenant lookup's own answer — a `domain` match is the storefront and an `admin_domain` match is the console — and that answer picks the PostgreSQL login the request is answered as (`publira_public` or `publira_admin`), whether an `admin-media` token is evaluated as a staff preview, and whether an episode body leaves encrypted.

## Running

From the repository root:

```bash
task server:dev-image-server
```

From the `server` directory:

```bash
go run ./cmd/image-server
```

Manael uses libvips, so building and running require `libvips-dev` (`libvips42` at runtime). The Dev Container includes them. The production image is `infra/docker/image/Dockerfile` (`CMD_NAME=image-server`).

## Main environment variables

- `PUBLIRA_IMAGE_SERVER_ADDR` (optional, `:8200` when unset)
- `PUBLIRA_IMAGE_DB_URL` / `PUBLIRA_PUBLIC_DB_URL` (optional. The storefront's pool; when neither is set, `postgres://publira_public:publicpass@db:5432/publira?sslmode=disable`)
- `PUBLIRA_ADMIN_IMAGE_DB_URL` / `PUBLIRA_ADMIN_DB_URL` (optional. The console's pool; when neither is set, `postgres://publira_admin:adminpass@db:5432/publira?sslmode=disable`)
- `PUBLIRA_AUTH_JWT_SECRET` (required, at least 32 bytes)
- `PUBLIRA_SECRET_ENCRYPTION_KEYS` / `PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID` (optional. Decrypt the access key of an object store saved with one)
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` (optional. The ambient credential for an object store saved without an access key)
- `PUBLIRA_REDIS_URL` (optional. Unset / `disabled` / `off` / `false` means the memory cache only. A `redis://` URL carrying a password stops the process at startup, because that scheme has no TLS: use `rediss://`)
- `PUBLIRA_IMAGE_CACHE_TTL` (optional. The TTL of a converted result. A Go duration or a number of seconds. Default `1h`)

The object store is read from the platform's settings on the console's pool, whose login is granted `platform_storage_config` and nothing else of the platform's; see [Image storage configuration](../../README.md#image-storage-configuration).

`/readyz` names one check per pool — `db.public` and `db.admin` — because a single `db` could not say which of the two logins stopped answering.

Conversion follows the request's `Accept` (`image/webp` / `image/avif`) and the `w` / `h` / `fit` / `q` query parameters. The key of the intermediate cache is derived from the same inputs, so one converted rendition is shared by both host names; encryption is applied to the response afterwards and never to what is cached. On a hit the response header is `X-Publira-Image-Cache: hit`, and on a miss it is `miss`.

## Authorization for episode body images

`GET /images/episodes/{media_id}` identifies the reader from `Authorization: Bearer <JWT>` (audience `public`) or from the `t=<JWT>` query (audience `media`), and treats a request carrying neither — or a credential that does not verify — as anonymous. Whichever it is, the grant itself is read from the database under the same rules as the API: `price = 0`, a valid purchase, or a valid access ticket. For the details, see the authentication sections of [server/README.md](../../README.md).

On a console host, a `t=<JWT>` of audience `admin-media` is evaluated as a preview for tenant staff on top of that reader-facing decision.

1. The user holds `tenant_admin` / `tenant_editor` / `tenant_auditor` in that tenant
2. The image belongs to an episode of that tenant
3. The token's `eid` matches that episode

The publication state and the price are not considered, so a draft, a scheduled, or a paid episode can still be checked from the admin UI's `<img>` / `next/image`. The tokens are appended to the URLs by `ListEpisodeImages` / `UploadEpisodeImages` / `ReorderEpisodeImages`. On a storefront host the same audience unlocks nothing, so a console URL carried to a tenant site is an ordinary anonymous request.
