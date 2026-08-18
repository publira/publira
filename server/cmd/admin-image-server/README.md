# admin-image-server

管理向け画像配送サーバーです。公開側の [image-server](../image-server/README.md) と同じ `imageserver` ハンドラを使い、Manael による WebP / AVIF 変換・縮小と中間キャッシュをそのまま載せます。待ち受けと DB 接続だけが管理ロール向けです。

## 起動

リポジトリルートから:

```bash
task server:dev-admin-image-server
```

`server` ディレクトリから:

```bash
go run ./cmd/admin-image-server
```

Manael は libvips を使うため、ビルドと実行には `libvips-dev`（実行時は `libvips42`）が必要です。Dev Container には含まれます。本番イメージは `infra/docker/image/Dockerfile`（`CMD_NAME=admin-image-server`）です。

## 主な環境変数

- `PUBLIRA_ADMIN_IMAGE_SERVER_ADDR` (任意, 既定 `:8201`)
- `PUBLIRA_ADMIN_IMAGE_DB_URL` / `PUBLIRA_ADMIN_DB_URL` (任意)
- `PUBLIRA_AUTH_JWT_SECRET` (必須, 32 バイト以上)
- `PUBLIRA_S3_BUCKET` (必須)
- `AWS_REGION` / `PUBLIRA_S3_ENDPOINT` / `PUBLIRA_S3_FORCE_PATH_STYLE` (ストレージ)
- `PUBLIRA_REDIS_URL` (任意。未設定 / `disabled` / `off` / `false` のときはメモリキャッシュのみ)
- `PUBLIRA_IMAGE_CACHE_TTL` (任意。変換結果の TTL。Go duration または秒数。既定 `1h`)

変換とキャッシュのキーは公開側と同じです。`Accept` と `w` / `h` / `fit` / `q` に従い、ヒット時は `X-Publira-Image-Cache: hit`、ミス時は `miss` です。
