# admin-api-server

管理向け ConnectRPC API サーバーです。

## 起動

リポジトリルートから:

```bash
make dev-admin-api
```

`server` ディレクトリから:

```bash
go run ./cmd/admin-api-server
```

ビルド済みバイナリを使う場合:

```bash
cd server && make build
./bin/admin-api-server
```

## 主な環境変数

- `PUBLIRA_ADMIN_API_ADDR` (任意, 未指定時 `:8001`)
- `DB_URL` (任意, 未指定時は開発用デフォルト)
- `PUBLIRA_STORAGE_BACKEND` (`local` または `s3`, 未指定時は `local`)
- `PUBLIRA_LOCAL_STORAGE_DIR` (`PUBLIRA_STORAGE_BACKEND=local` 時, 未指定時 `/tmp/publira-storage`)
- `PUBLIRA_LOCAL_STORAGE_BASE_URL` (`PUBLIRA_STORAGE_BACKEND=local` 時, 任意)
- `PUBLIRA_S3_BUCKET` (`PUBLIRA_STORAGE_BACKEND=s3` 時は必須)
- `AWS_REGION` (`PUBLIRA_STORAGE_BACKEND=s3` 時, 任意)
- `PUBLIRA_S3_ENDPOINT` (`PUBLIRA_STORAGE_BACKEND=s3` 時, 任意)
- `PUBLIRA_S3_FORCE_PATH_STYLE` (`PUBLIRA_STORAGE_BACKEND=s3` 時, 任意)
- `PUBLIRA_S3_PUBLIC_BASE_URL` (`PUBLIRA_STORAGE_BACKEND=s3` 時, 任意)
- `PUBLIRA_REVALIDATE_TOKEN` (任意, `X-Revalidate-Token` ヘッダーで送る共有トークン)

`PUBLIRA_REVALIDATE_TOKEN` が設定されている場合のみ、公開状態更新時に Next.js へ再検証リクエストを送信します。このとき内部ネットワーク上の Traefik 宛に送信し、`Host`/`X-Forwarded-Host` はテナントの `domain` を設定します。固定パスは次のとおりです:

- web-host: `/api/revalidate`
