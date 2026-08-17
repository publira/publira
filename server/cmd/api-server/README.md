# api-server

公開向け ConnectRPC API サーバーです。

## 起動

リポジトリルートから:

```bash
make dev-api
```

`server` ディレクトリから:

```bash
go run ./cmd/api-server
```

ビルド済みバイナリを使う場合:

```bash
cd server && make build
./bin/api-server
```

## 主な環境変数

- `DB_URL` (任意, 未指定時は開発用デフォルト)
- `PUBLIRA_STORAGE_BACKEND` (`local` または `s3`, 未指定時は `local`)
- `PUBLIRA_LOCAL_STORAGE_DIR` (`PUBLIRA_STORAGE_BACKEND=local` 時, 未指定時 `/tmp/publira-storage`)
- `PUBLIRA_LOCAL_STORAGE_BASE_URL` (`PUBLIRA_STORAGE_BACKEND=local` 時, 任意)
- `PUBLIRA_S3_BUCKET` (`PUBLIRA_STORAGE_BACKEND=s3` 時は必須)
- `AWS_REGION` (`PUBLIRA_STORAGE_BACKEND=s3` 時, 任意)
- `PUBLIRA_S3_ENDPOINT` (`PUBLIRA_STORAGE_BACKEND=s3` 時, 任意)
- `PUBLIRA_S3_FORCE_PATH_STYLE` (`PUBLIRA_STORAGE_BACKEND=s3` 時, 任意)
- `PUBLIRA_S3_PUBLIC_BASE_URL` (`PUBLIRA_STORAGE_BACKEND=s3` 時, 任意)

## 備考

- 既定の待ち受けアドレスは `:8000` です。
