# image-server

The public image delivery server. After checking permissions, it converts images to WebP / AVIF with Manael, resizes them, caches the converted result, and returns it.

## Running

From the repository root:

```bash
task server:dev-image-server
```

From the `server` directory:

```bash
go run ./cmd/image-server
```

Manael uses libvips, so building and running require `libvips-dev` (`libvips42` at runtime). The Dev Container includes them. The production image is `infra/docker/image/Dockerfile` (`CMD_NAME=image-server`). On the admin side, [admin-image-server](../admin-image-server/README.md) mounts the same handler.

## Main environment variables

- `PUBLIRA_IMAGE_SERVER_ADDR` (optional, default `:8200`)
- `PUBLIRA_IMAGE_DB_URL` / `PUBLIRA_PUBLIC_DB_URL` (optional. When neither is set, `postgres://publira_public:publicpass@db:5432/publira?sslmode=disable`)
- `PUBLIRA_AUTH_JWT_SECRET` (required, at least 32 bytes)
- `PUBLIRA_S3_BUCKET` (required)
- `AWS_REGION` / `PUBLIRA_S3_ENDPOINT` / `PUBLIRA_S3_FORCE_PATH_STYLE` (storage)
- `PUBLIRA_REDIS_URL` (optional. Unset / `disabled` / `off` / `false` means the memory cache only)
- `PUBLIRA_IMAGE_CACHE_TTL` (optional. The TTL of a converted result. A Go duration or a number of seconds. Default `1h`)

Conversion follows the request's `Accept` (`image/webp` / `image/avif`) and the `w` / `h` / `fit` / `q` query parameters. The key of the intermediate cache is derived from the same inputs. On a hit the response header is `X-Publira-Image-Cache: hit`, and on a miss it is `miss`.

## Authorization for episode body images

`GET /images/episodes/{media_id}` identifies the reader from `Authorization: Bearer <JWT>` (audience `public`) or from the `t=<JWT>` query (audience `media`), and treats a request carrying neither — or a credential that does not verify — as anonymous. Whichever it is, the grant itself is read from the database under the same rules as the API: `price = 0`, a valid purchase, or a valid access ticket. The `admin-media` tokens meant for the admin UI are not verified by this process. For the details, see the authentication sections of [server/README.md](../../README.md).
