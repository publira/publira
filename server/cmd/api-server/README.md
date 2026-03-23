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
- `STORAGE_BACKEND` (`local` または `s3`, 未指定時は `local`)
- `LOCAL_STORAGE_DIR` (`STORAGE_BACKEND=local` 時, 未指定時 `/tmp/publira-storage`)
- `LOCAL_STORAGE_BASE_URL` (`STORAGE_BACKEND=local` 時, 任意)
- `S3_BUCKET` (`STORAGE_BACKEND=s3` 時は必須)
- `AWS_REGION` (`STORAGE_BACKEND=s3` 時, 任意)
- `S3_ENDPOINT` (`STORAGE_BACKEND=s3` 時, 任意)
- `S3_FORCE_PATH_STYLE` (`STORAGE_BACKEND=s3` 時, 任意)
- `S3_PUBLIC_BASE_URL` (`STORAGE_BACKEND=s3` 時, 任意)

## 備考

- 既定の待ち受けアドレスは `:8000` です。
