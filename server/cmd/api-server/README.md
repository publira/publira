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

- `PUBLIRA_PUBLIC_DB_URL` (任意, 未指定時は開発用デフォルト)
- `PUBLIRA_AUTH_JWT_SECRET` (必須, 32 バイト以上。アクセストークンの HS256 署名鍵。未設定なら起動に失敗する。詳細は [リポジトリ README](../../../README.md#api-access-token-signing-key-publira_auth_jwt_secret))
- `PUBLIRA_S3_BUCKET` (必須)
- `AWS_REGION` (任意)
- `PUBLIRA_S3_ENDPOINT` (任意)
- `PUBLIRA_S3_FORCE_PATH_STYLE` (任意)
- `PUBLIRA_S3_PUBLIC_BASE_URL` (任意)
- `PUBLIRA_TRACING_ENABLED` (任意, 既定は無効。OpenTelemetry トレースの有効化)
- `PUBLIRA_DEPLOYMENT_ENVIRONMENT` (任意, 未指定時 `development`。`deployment.environment.name` と既定サンプリング率を決める)

トレースの属性・span 命名・サンプリング・`OTEL_*` の一覧は [server/README.md](../../README.md#分散トレーシング-opentelemetry) にあります。

## 備考

- 既定の待ち受けアドレスは `:8000` です。
