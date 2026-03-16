# Publira

## プロダクトビジョン

IT リソースが限られる出版社向けに、自社ブランドで運用できるデジタル配信基盤 (マンガ・小説) を提供するマルチテナント型 SaaS です。
出版社・編集者がクリエイターから受領した書籍情報を入稿し、エンドユーザーは Web / モバイルから閲覧します。

OSSとして、ポータビリティ・運用のしやすさ・ベンダーロックイン回避を重視します。

## ディレクトリ構造

```text
.
├── apps/               # [Node.js] Web アプリ (Turborepo)
│   ├── web-host/       # エンドユーザー向け閲覧サイト
│   └── web-admin/      # 出版社・編集者向け入稿/管理画面
├── packages/           # [Node.js] 共有 UI / ユーティリティ
├── server/             # [Go] バックエンドシステム (単一モジュール)
│   ├── cmd/
│   │   ├── api-server/       # ConnectRPC API サーバー
│   │   └── publish-episodes/ # 単発バッチ処理
│   ├── gen/            # buf 自動生成コード (Go)
│   └── internal/
│       └── db/         # sqlc 自動生成コード (DB/Go)
├── mobile/             # [Flutter] モバイルアプリ (iOS/Android)
├── proto/              # Protocol Buffers スキーマ定義
└── db/                 # PostgreSQL スキーマ/クエリ
```

## 技術スタック

- Frontend: Next.js (App Router), React, TypeScript, Tailwind CSS
- Backend: Go 1.26, ConnectRPC (HTTP/2), sqlc
- Mobile: Flutter
- Database: PostgreSQL
- Storage/Image: S3 互換ストレージ
- Infrastructure: Dev Containers, Docker, Make

## ドキュメント案内

- 全体ロードマップ: [TODO.md](TODO.md)
- Web アプリ: [apps/README.md](apps/README.md)
- 共有パッケージ: [packages/README.md](packages/README.md)
- Go バックエンド: [server/README.md](server/README.md)
- モバイル: [mobile/README.md](mobile/README.md)

## セットアップ

```bash
make setup
```
