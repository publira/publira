# image-server

公開向け画像配送サーバーです。権限確認のあと、Manael で WebP / AVIF への変換と縮小を行い、変換結果を中間キャッシュして返します。

## 起動

リポジトリルートから:

```bash
task server:dev-image-server
```

`server` ディレクトリから:

```bash
go run ./cmd/image-server
```

Manael は libvips を使うため、ビルドと実行には `libvips-dev`（実行時は `libvips42`）が必要です。Dev Container には含まれます。本番イメージは `infra/docker/image/Dockerfile`（`CMD_NAME=image-server`）です。管理向けは同じハンドラを [admin-image-server](../admin-image-server/README.md) が載せます。

## 主な環境変数

- `PUBLIRA_IMAGE_SERVER_ADDR` (任意, 既定 `:8200`)
- `PUBLIRA_IMAGE_DB_URL` / `PUBLIRA_PUBLIC_DB_URL` (任意。どちらも未設定なら `postgres://publira_public:publicpass@db:5432/publira?sslmode=disable`)
- `PUBLIRA_AUTH_JWT_SECRET` (必須, 32 バイト以上)
- `PUBLIRA_S3_BUCKET` (必須)
- `AWS_REGION` / `PUBLIRA_S3_ENDPOINT` / `PUBLIRA_S3_FORCE_PATH_STYLE` (ストレージ)
- `PUBLIRA_REDIS_URL` (任意。未設定 / `disabled` / `off` / `false` のときはメモリキャッシュのみ)
- `PUBLIRA_IMAGE_CACHE_TTL` (任意。変換結果の TTL。Go duration または秒数。既定 `1h`)

変換はリクエストの `Accept`（`image/webp` / `image/avif`）と `w` / `h` / `fit` / `q` クエリに従います。中間キャッシュのキーも同じ入力から決まります。ヒット時はレスポンスヘッダ `X-Publira-Image-Cache: hit`、ミス時は `miss` です。

## エピソード本文画像の認可

`GET /images/episodes/{media_id}` は次の順で読者を特定します。

1. `Authorization: Bearer <JWT>`（audience `public`）
2. クエリ `t=<JWT>`（audience `media`。ブラウザの `<img>` はヘッダーを付けられないため、`GetEpisodeDetail` が URL に付けて返す）
3. どちらも無い / 検証に失敗した場合は無記名扱い

特定できた場合は `GetEpisodeImageAccessByIDForUser`、無記名なら `GetEpisodeImagePublicAccessByIDForTenant` で判定します。どちらも「`price = 0` / 有効な purchase / 有効な access ticket」という API と同じ規則です。`media` トークンは発行元のエピソード以外には効かず、クエリの `t` は中間キャッシュのキーに含めません。詳細は [server/README.md](../../README.md) の認証節を参照してください。
