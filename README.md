# Publira

## プロダクトビジョン

IT リソースが限られる出版社向けに、自社ブランドで運用できるデジタル配信基盤 (マンガ・小説) を提供するマルチテナント型 SaaS です。出版社・編集者がクリエイターから受領した書籍情報を入稿し、エンドユーザーは Web / モバイルから閲覧します。

OSSとして、ポータビリティ・運用のしやすさ・ベンダーロックイン回避を重視します。

## ディレクトリ構造

```text
.
├── apps/               # [Node.js] Web アプリ (Turborepo)
│   ├── web-host/       # テナント公開サイト (カタログ/認証/マイページ)
│   ├── web-admin/      # 出版社・編集者向け入稿/管理画面
│   ├── web-platform/   # プラットフォーム運営者向け横断運用画面
│   └── email-renderer/ # React Email を ConnectRPC で描画する Node サービス
├── packages/           # [Node.js] 共有 UI / ユーティリティ
├── e2e/                # [Playwright] Web 横断 E2E 基盤
├── server/             # [Go] バックエンドシステム (単一モジュール)
│   ├── cmd/
│   │   ├── api-server/       # ConnectRPC API サーバー
│   │   └── publish-episodes/ # 単発バッチ処理
│   ├── gen/            # buf 自動生成コード (Go)
│   └── internal/
│       └── db/         # sqlc 自動生成コード (DB/Go)
├── infra/
│   └── docker/         # 本番用 Dockerfile（ロール別・ルートからビルド）
├── mobile/             # [Flutter] モバイルアプリ (iOS/Android)
├── proto/              # Protocol Buffers スキーマ定義
├── locales/            # 共有 UI メッセージ（JSON。Go / Web / Flutter が同じファイルを読む）
└── db/                 # PostgreSQL migration/クエリ
```

## 技術スタック

- Frontend: Next.js (App Router), React, TypeScript, Tailwind CSS
- Backend: Go 1.26, ConnectRPC (HTTP/2), sqlc
- Mobile: Flutter
- Database: PostgreSQL, golang-migrate
- Cache: Redis（Next.js `cacheHandler` / `cacheHandlers` の共有ストア）
- Storage/Image: S3 互換ストレージ
- Infrastructure: Dev Containers, Docker, Make

## ドキュメント案内

- エージェント向け規約（Effect / lint など）: [AGENTS.md](AGENTS.md)
- Web アプリ: [apps/README.md](apps/README.md)
- 共有パッケージ: [packages/README.md](packages/README.md)
- Go バックエンド: [server/README.md](server/README.md)
- モバイル: [mobile/README.md](mobile/README.md)
- CI ワークフロー全体（ジョブ構成・path filter・トリアージ）: [.github/workflows/README.md](.github/workflows/README.md)
- Dockerfile 配置規約・ビルド検証（本番イメージ）: [infra/docker/README.md](infra/docker/README.md)
- E2E（Playwright 基盤・CI）: [e2e/README.md](e2e/README.md)
- 開発環境 bootstrap チェック（空 DB volume からの `task setup` / `task dev` 検証）: [e2e/bootstrap/README.md](e2e/bootstrap/README.md)
- 開発環境 Traefik ルーティング疎通（ホスト / `/api` / `/images`）: [e2e/routing/README.md](e2e/routing/README.md)

## セットアップ

```bash
task setup
```

`task setup` は依存インストール（`pnpm` / Go / Flutter `pub get`）と DB 初期化を実行します。Dev Container では `postCreate` から自動実行されるため、`mobile/` の依存解決も追加操作なしで済みます。

Dev Container では `migrate` CLI (golang-migrate) を同梱しています。DB 変更は `db/migrations/` に `.up.sql` / `.down.sql` で追加してください。

## ローカル DB 初期化

```bash
task db:setup
```

`db:setup` は次を順に実行します。

1. migration 適用 (`db/migrations/`)
2. baseline seed 適用 (`db/seeds/baseline/`)

### migration と seed の責務

- migration: スキーマの変更（DDL）
- seed: ローカル開発・画面確認用の初期データ（DML、冪等）

seed の詳細と固定ログイン情報は `db/seeds/README.md` を参照してください。

## 開発用メール確認 (Mailpit)

Dev Container 起動時に Mailpit コンテナも起動します。

- Mailpit UI: `http://localhost:8025`
- SMTP (コンテナ内から): `host=mailpit`, `port=1025`

ローカル seed (`task db:setup`) では platform/tenant SMTP の初期値が Mailpit 向けになります。

1. `task db:setup` を実行して初期データを反映
2. `task dev` (または API/Web 個別タスク) を起動
3. SMTP テスト送信や通知送信を実行
4. Mailpit UI (`http://localhost:8025`) で受信メールを確認

## Next.js 共有キャッシュ (Redis)

self-host / multi-instance 向けに、Next.js のサーバー側キャッシュを **Redis** で共有します（`@publira/next-cache-handlers`）。

| 設定 | 用途 |
| --- | --- |
| `cacheHandlers`（複数形） | `"use cache"` / `"use cache: remote"` |
| `cacheHandler`（単数） | ISR・Route Handler・`fetch`、および `next/image` 最適化結果（`images.customCacheHandler: true`） |

- Dev Container では `redis` サービスが起動し、app コンテナに `PUBLIRA_REDIS_URL=redis://redis:6379` が渡ります（認証を設定していないため、ホストには公開しません）
- 中身を直接見たいときは `docker compose -f .devcontainer/compose.yaml exec redis redis-cli`
- `redis://localhost:6379` は `@publira/next-cache-handlers` が `PUBLIRA_REDIS_URL` 未設定時に使うライブラリ側の既定値です
- キー空間は `PUBLIRA_CACHE_APP`（例: `web-host`）でアプリ別に分離
- 詳細: [packages/next-cache-handlers/README.md](packages/next-cache-handlers/README.md)

## 開発用オブジェクトストレージ (RustFS)

Dev Container 起動時に S3 互換の **RustFS** コンテナも起動し、アプリは本番と同じ経路で動きます（エピソード画像のアップロードと image-server の配信）。

- コンソール UI: `http://localhost:9001/rustfs/console/`
- S3 エンドポイント（コンテナ内から）: `http://rustfs:9000`（path-style。ホストには公開しません）
- バケット: `publira`。`task setup` / `task dev` が `task storage:init` で冪等に作成します
- データは `rustfs-data` volume に永続します

app コンテナに渡す既定値は `.devcontainer/compose.yaml` にあります。

| 変数                                          | 既定値                    |
| --------------------------------------------- | ------------------------- |
| `PUBLIRA_S3_BUCKET`                           | `publira`                 |
| `PUBLIRA_S3_ENDPOINT`                         | `http://rustfs:9000`      |
| `PUBLIRA_S3_FORCE_PATH_STYLE`                 | `true`                    |
| `AWS_REGION`                                  | `us-east-1`               |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | `publira` / `publirapass` |

このアクセスキーは **ローカル開発専用**です（RustFS コンテナにしか通用しません）。本番の S3 は IAM ロールや別途払い出した資格情報を使い、この値を持ち込まないでください。バケット作成には aws CLI を使うため、Dev Container では `aws-cli` feature を同梱しています。

サーバー側の環境変数一覧は [server/README.md](server/README.md) を参照してください。
