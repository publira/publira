# server

Go バックエンドです。単一モジュール `github.com/publira/publira/server` で運用します。

## ディレクトリ構成

```text
server/
├── cmd/
│   ├── api-server/        # 公開向け ConnectRPC API サーバー
│   ├── admin-api-server/  # 管理向け ConnectRPC API サーバー
│   ├── platform-api-server/ # プラットフォーム管理向け ConnectRPC API サーバー
│   └── publish-episodes/  # 単発バッチ処理
├── bin/                   # task build で生成されるバイナリ
├── gen/                   # buf 自動生成コード (編集禁止)
└── internal/
    └── db/                # sqlc 自動生成コード (編集禁止)
```

## 担当機能

- マルチテナント運用の API 提供
- コンテンツ入稿/公開に関する業務ロジック
- 予約公開バッチ (公開状態への遷移)
- 認証・セキュリティ基盤

## 実装ルール

1. スキーマ駆動開発: API/DB の変更は `proto/` または `db/migrations/` の golang-migrate 形式 (`.up.sql` / `.down.sql`) を先に変更し、`task gen` を実行する
2. `cmd/` は薄く保ち、実装は `internal/` に寄せる
3. バッチは常駐型にせず、1 回の処理で終了する

## 開発コマンド

```bash
task db:setup
task db:seed
task db:create NAME=add_example_column
task server:dev-api
task server:dev-admin-api
task server:dev-platform-api
task server:tidy
task server:build
```

## エントリポイント詳細

- 公開 API サーバー: [cmd/api-server/README.md](cmd/api-server/README.md)
- 管理 API サーバー: [cmd/admin-api-server/README.md](cmd/admin-api-server/README.md)
- プラットフォーム API サーバー: [cmd/platform-api-server/README.md](cmd/platform-api-server/README.md)
- 予約公開バッチ: [cmd/publish-episodes/README.md](cmd/publish-episodes/README.md)

## 画像ストレージ設定

`UploadEpisodeImages` は `STORAGE_BACKEND` で保存先を切り替えます。

- `STORAGE_BACKEND=local` (デフォルト)
  - `LOCAL_STORAGE_DIR` (省略時: `/tmp/publira-storage`)
  - `LOCAL_STORAGE_BASE_URL` (任意)
- `STORAGE_BACKEND=s3`
  - `S3_BUCKET` (必須)
  - `AWS_REGION` (推奨)
  - `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` (必要に応じて)
  - `S3_ENDPOINT` (任意, MinIO 等)
  - `S3_FORCE_PATH_STYLE` (任意, `true`/`false`)
  - `S3_PUBLIC_BASE_URL` (任意)

## Platform Console URL

- `PUBLIRA_PLATFORM_APP_URL`
  - platform-auth のパスワード再設定メールに含める Platform Console のベース URL
  - 例: `https://platform.example.com`
  - 未設定時はローカル開発向けに `http://platform.localhost:3080` を使用

## 機密情報の暗号化設定 (AES-GCM)

機密情報を保存時に AES-GCM で暗号化するための基盤を用意しています。
現時点では機密項目の保存経路に適用したときに、以下の環境変数を設定してください。

- `SECRET_ENCRYPTION_KEYS`
  - 形式: `key-id-1:base64key,key-id-2:base64key`
  - `base64key` は 16/24/32 byte の AES 鍵を Base64 (標準 or URL-safe) でエンコードした値
- `SECRET_ENCRYPTION_PRIMARY_KEY_ID`
  - `SECRET_ENCRYPTION_KEYS` に含まれる key-id を指定
  - 新規暗号化時はこの key-id を使用

鍵ローテーション方針:

1. 新鍵を `SECRET_ENCRYPTION_KEYS` に追加する
2. `SECRET_ENCRYPTION_PRIMARY_KEY_ID` を新鍵 ID に切り替える
3. 既存データを再保存/再暗号化して旧鍵暗号文を徐々に置換する
4. 旧鍵で復号されるデータがなくなったことを確認してから旧鍵を削除する

注意:

- 鍵や平文をログへ出力しない
- 暗号化/復号に失敗した場合は処理を継続せず失敗として扱う

## 認証 (JWT アクセストークン)

API は email + password で **HS256 JWT アクセストークン** を発行します（`Login` / `Logout`）。  
ブラウザ向け Cookie は Next.js 側が `jose` で JWE 管理し、API へは `Authorization: Bearer <token>` のみを送ります。

| 項目        | 値                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------- |
| 環境変数    | `AUTH_JWT_SECRET`（32 文字以上。未設定時は開発用フォールバック）                            |
| TTL         | 24h                                                                                         |
| Audience    | `public` / `admin` / `platform`                                                             |
| 失効        | `users.credentials_version` / `platform_users.credentials_version`（パスワード変更等で +1） |
| Next Cookie | `AUTH_SECRET`（JWE 用、API の JWT secret とは別） / Cookie 名: `publira_web_host_auth` 等   |

## API サーバ分離

- 公開 API サーバー: `server/cmd/api-server`
  - 公開サービス: `CatalogService`, `AuthService`
  - 既定ポート: `:8000`
- 管理 API サーバー: `server/cmd/admin-api-server`
  - 管理サービス: `AdminSeriesService`, `AdminAuthService`
  - 既定ポート: `:8001` (`ADMIN_API_ADDR` で変更可能)
  - 公開状態変更時の Next.js 再検証: `NEXT_REVALIDATE_TOKEN` を設定
  - 送信先は内部 Traefik 経由（`Host` は tenant domain を使用）

これにより、公開系と管理系を別プロセス・別経路で運用できます。

## DB ユーザー構成

各 API サーバーは専用の PostgreSQL ログインユーザーで接続し、最小権限を実現します。

| サーバー     | DB ユーザー        | 環境変数                  | ローカルデフォルト                                                         |
| ------------ | ------------------ | ------------------------- | -------------------------------------------------------------------------- |
| platform-api | `publira_platform` | `PUBLIRA_PLATFORM_DB_URL` | `postgres://publira_platform:platformpass@db:5432/publira?sslmode=disable` |
| admin-api    | `publira_admin`    | `PUBLIRA_ADMIN_DB_URL`    | `postgres://publira_admin:adminpass@db:5432/publira?sslmode=disable`       |
| api (public) | `publira_public`   | `PUBLIRA_PUBLIC_DB_URL`   | `postgres://publira_public:publicpass@db:5432/publira?sslmode=disable`     |

`publira_platform` は BYPASSRLS 属性を持ち、全テナントのデータに横断アクセスします。  
`publira_admin` / `publira_public` は RLS が有効で、テナント ID でスコープされます。

### ローカル開発

`task db:setup` 実行時に `db/seeds/baseline/000_rls_bypass_role.sql` が適用され、3 ユーザーが作成されます。

### 本番環境

seed を実行後、各ユーザーのパスワードを安全な値に変更してください:

```sql
ALTER ROLE publira_platform PASSWORD '<secure_password>';
ALTER ROLE publira_admin    PASSWORD '<secure_password>';
ALTER ROLE publira_public   PASSWORD '<secure_password>';
```

次に各サーバーの環境変数 (`PUBLIRA_PLATFORM_DB_URL`, `PUBLIRA_ADMIN_DB_URL`, `PUBLIRA_PUBLIC_DB_URL`) にそれぞれのパスワードを含む URL を設定してください。

## 初期データメモ

- AuthService を使うには、最低限 `tenants` と `users` のデータが必要です。
- `users.password_hash` は `bcrypt` ハッシュを利用してください。
- API 起動確認は `GET /healthz` を利用してください。
