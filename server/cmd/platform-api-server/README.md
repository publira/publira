# platform-api-server

プラットフォーム管理向け ConnectRPC API サーバーです。

## 起動

リポジトリルートから:

```bash
make dev-platform-api
```

`server` ディレクトリから:

```bash
go run ./cmd/platform-api-server
```

ビルド済みバイナリを使う場合:

```bash
cd server && make build
./bin/platform-api-server
```

## 主な環境変数

- `PLATFORM_API_ADDR` (任意, 未指定時 `:8002`)
- `DB_URL` (任意, 未指定時は開発用デフォルト)
