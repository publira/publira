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

- `PUBLIRA_PLATFORM_API_ADDR` (任意, 未指定時 `:8002`)
- `PUBLIRA_PLATFORM_DB_URL` (任意, 未指定時は開発用デフォルト)
- `PUBLIRA_AUTH_JWT_SECRET` (必須, 32 バイト以上。アクセストークンの HS256 署名鍵。未設定なら起動に失敗する。詳細は [リポジトリ README](../../../README.md#api-アクセストークンの署名鍵-publira_auth_jwt_secret))

## ロール権限

| 操作 | `platform_auditor` | `platform_operator` | `platform_super_admin` |
| --- | --- | --- | --- |
| ダッシュボード、テナント・ユーザー・監査ログ・設定・通知の閲覧 | 可 | 可 | 可 |
| テナント、テナントメンバー、テナント管理者招待、エンドユーザー、SMTP、プラットフォーム設定の変更 | 不可 | 可 | 可 |
| プラットフォームオペレーターの作成、ロール変更、停止、有効化、無効化 | 不可 | 不可 | 可 |
| 自分の通知の既読化、ログアウト、パスワード・メールアドレス変更 | 可 | 可 | 可 |

サーバーは変更系 RPC を共通インターセプターで検査するため、拒否時は DB 更新、監査ログ記録、メール送信を開始しません。
