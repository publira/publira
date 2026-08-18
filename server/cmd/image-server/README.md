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
- `PUBLIRA_IMAGE_DB_URL` / `PUBLIRA_PUBLIC_DB_URL` (任意)
- `PUBLIRA_AUTH_JWT_SECRET` (必須, 32 バイト以上)
- `PUBLIRA_S3_BUCKET` (必須)
- `AWS_REGION` / `PUBLIRA_S3_ENDPOINT` / `PUBLIRA_S3_FORCE_PATH_STYLE` (ストレージ)
- `PUBLIRA_REDIS_URL` (任意。未設定 / `disabled` / `off` / `false` のときはメモリキャッシュのみ)
- `PUBLIRA_IMAGE_CACHE_TTL` (任意。変換結果の TTL。Go duration または秒数。既定 `1h`)

変換はリクエストの `Accept`（`image/webp` / `image/avif`）と `w` / `h` / `fit` / `q` クエリに従います。中間キャッシュのキーも同じ入力から決まります。ヒット時はレスポンスヘッダ `X-Publira-Image-Cache: hit`、ミス時は `miss` です。
