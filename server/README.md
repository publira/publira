# server

Go バックエンドです。単一モジュール `github.com/publira/publira/server` で運用します。

## ディレクトリ構成

```text
server/
├── cmd/
│   ├── api-server/        # ConnectRPC API サーバー
│   └── publish-episodes/  # 単発バッチ処理
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

1. スキーマ駆動開発: API/DB の変更は `proto/` または `db/schema/` を先に変更し、`make gen` を実行する
2. `cmd/` は薄く保ち、実装は `internal/` に寄せる
3. バッチは常駐型にせず、1 回の処理で終了する

## 開発コマンド

```bash
make dev-api
make run-batch-publish
cd server && go mod tidy
cd server && go build ./...
```

## 初期データメモ

- AuthService を使うには、最低限 `tenants` と `users` のデータが必要です。
- `users.password_hash` は当面、`bcrypt` ハッシュを推奨します (初期実装では平文一致フォールバックあり)。
- API 起動確認は `GET /healthz` を利用してください。
