# admin-image-server

The admin image delivery server. It uses the same `imageserver` handler as the public [image-server](../image-server/README.md), carrying over the Manael WebP / AVIF conversion, the resizing, and the intermediate cache as they are. Its listen address and DB connection are for the admin role, and it adds an administrator preview decision for episode body images only.

## Running

From the repository root:

```bash
task server:dev-admin-image-server
```

From the `server` directory:

```bash
go run ./cmd/admin-image-server
```

Manael uses libvips, so building and running require `libvips-dev` (`libvips42` at runtime). The Dev Container includes them. The production image is `infra/docker/image/Dockerfile` (`CMD_NAME=admin-image-server`).

## Main environment variables

- `PUBLIRA_ADMIN_IMAGE_SERVER_ADDR` (optional, default `:8201`)
- `PUBLIRA_ADMIN_IMAGE_DB_URL` / `PUBLIRA_ADMIN_DB_URL` (optional. When neither is set, `postgres://publira_admin:adminpass@db:5432/publira?sslmode=disable`)
- `PUBLIRA_AUTH_JWT_SECRET` (required, at least 32 bytes)
- `PUBLIRA_S3_BUCKET` (required)
- `AWS_REGION` / `PUBLIRA_S3_ENDPOINT` / `PUBLIRA_S3_FORCE_PATH_STYLE` (storage)
- `PUBLIRA_REDIS_URL` (optional. Unset / `disabled` / `off` / `false` means the memory cache only)
- `PUBLIRA_IMAGE_CACHE_TTL` (optional. The TTL of a converted result. A Go duration or a number of seconds. Default `1h`)

Conversion and the cache key are the same as on the public side. They follow `Accept` and `w` / `h` / `fit` / `q`, and the response is `X-Publira-Image-Cache: hit` on a hit and `miss` on a miss.

## Authorization for episode body images

It serves the same `GET /images/episodes/{media_id}` as the public side, and keeps the reader-facing decision (a purchase, a ticket, or published with `price = 0`) intact. On top of that, when the audience of the `t=<JWT>` query is `admin-media`, the request is evaluated as a preview for tenant staff.

1. The user holds `tenant_admin` / `tenant_editor` / `tenant_auditor` in that tenant
2. The image belongs to an episode of that tenant
3. The token's `eid` matches that episode

The publication state and the price are not considered, so a draft, a scheduled, or a paid episode can still be checked from the admin UI's `<img>` / `next/image`. An `admin-media` token is not verified by the public image-server, so a copied admin preview URL carries no preview privilege there: it is served as an anonymous request under the ordinary reader rules, which still refuse a draft, a scheduled, or a paid episode. The tokens are appended to the URLs by `ListEpisodeImages` / `UploadEpisodeImages` / `ReorderEpisodeImages`. For the details, see the authentication sections of [server/README.md](../../README.md).
