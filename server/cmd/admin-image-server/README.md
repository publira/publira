# admin-image-server

管理向け画像配送サーバーです。公開側の [image-server](../image-server/README.md) と同じ `imageserver` ハンドラを使い、Manael による WebP / AVIF 変換・縮小と中間キャッシュをそのまま載せます。待ち受けと DB 接続は管理ロール向けで、エピソード本文画像だけ管理者プレビュー用の判定を足します。

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
- `PUBLIRA_ADMIN_IMAGE_DB_URL` / `PUBLIRA_ADMIN_DB_URL` (任意。どちらも未設定なら `postgres://publira_admin:adminpass@db:5432/publira?sslmode=disable`)
- `PUBLIRA_AUTH_JWT_SECRET` (必須, 32 バイト以上)
- `PUBLIRA_S3_BUCKET` (必須)
- `AWS_REGION` / `PUBLIRA_S3_ENDPOINT` / `PUBLIRA_S3_FORCE_PATH_STYLE` (ストレージ)
- `PUBLIRA_REDIS_URL` (任意。未設定 / `disabled` / `off` / `false` のときはメモリキャッシュのみ)
- `PUBLIRA_IMAGE_CACHE_TTL` (任意。変換結果の TTL。Go duration または秒数。既定 `1h`)

変換とキャッシュのキーは公開側と同じです。`Accept` と `w` / `h` / `fit` / `q` に従い、ヒット時は `X-Publira-Image-Cache: hit`、ミス時は `miss` です。

## エピソード本文画像の認可

公開側と同じ `GET /images/episodes/{media_id}` を扱い、読者向けの判定（purchase / ticket / 公開かつ `price = 0`）もそのまま残します。そのうえで、クエリ `t=<JWT>` の audience が `admin-media` のときはテナントスタッフ向けのプレビューとして評価します。

1. ユーザーが当該テナントの `tenant_admin` / `tenant_editor` / `tenant_auditor` である
2. 画像がそのテナントのエピソードに属する
3. トークンの `eid` がそのエピソードと一致する

公開状態と価格は見ません。下書き・公開予約・有料エピソードでも、管理画面の `<img>` / `next/image` から確認できます。`admin-media` トークンは公開側 image-server では検証されないので、コピーした管理プレビュー URL が公開ホストで本文を開きません。トークンは `ListEpisodeImages` / `UploadEpisodeImages` / `ReorderEpisodeImages` が URL に付けます。詳細は [server/README.md](../../README.md) の認証節を参照してください。
