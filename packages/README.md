# packages

Node.js 側で共有するパッケージ群です。

## パッケージ一覧

- `api-client/`: 公開 API 向け ConnectRPC TypeScript クライアント (`make gen` で再生成)
- `ui-components/`: `web-host` / `web-admin` 共有 UI コンポーネント

## 運用ルール

- `api-client/src/gen/` 以下は自動生成物のため直接編集しない
- API 変更時は `proto/` を更新して `make gen` を実行する
- `ui-components/` はテナント別テーマ適用を前提とした再利用部品を優先する
