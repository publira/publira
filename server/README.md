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
task db:create NAME=add_sessions_table
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

## API サーバ分離

- 公開 API サーバー: `server/cmd/api-server`
  - 公開サービス: `CatalogService`, `AuthService`
  - 既定ポート: `:8000`
- 管理 API サーバー: `server/cmd/admin-api-server`
  - 管理サービス: `AdminSeriesService`, `AdminAuthService`
  - 既定ポート: `:8001` (`ADMIN_API_ADDR` で変更可能)

これにより、公開系と管理系を別プロセス・別経路で運用できます。

## 初期データメモ

- AuthService を使うには、最低限 `tenants` と `users` のデータが必要です。
- `users.password_hash` は `bcrypt` ハッシュを利用してください。
- API 起動確認は `GET /healthz` を利用してください。
