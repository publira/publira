# packages

Node.js 側で共有するパッケージ群です。

## パッケージ一覧

- `api-client/`: 公開 API 向け ConnectRPC TypeScript クライアント (`task gen` で再生成)
- `brand/`: Web 向けブランドトークン (`theme.css`)
- `layouts/`: 複数 Web アプリで共有するレイアウトコンポーネント
- `tsconfig/`: ワークスペース共通 TypeScript 設定
- `ui-components/`: `web-host` / `web-admin` 共有 UI コンポーネント
- `utils/`: 共有ユーティリティ (`cn` など)
- `web-session/`: Next.js 向け jose JWE セッション Cookie ヘルパ（Bearer 付与含む）

## 運用ルール

- `api-client/src/gen/` 以下は自動生成物のため直接編集しない
- API 変更時は `proto/` を更新して `task gen` を実行する
- `brand/` の token 変更時は UI 影響範囲を確認する
- `layouts/` と `ui-components/` は Base UI と brand token の整合を優先する
- `tsconfig/` 変更時は全アプリへの影響を確認する
- `ui-components/` はテナント別テーマ適用を前提とした再利用部品を優先する
- `utils/` は特定 app 依存を持たない汎用処理のみを置く
