# apps

Web フロントエンド群です。Turborepo 上で Next.js アプリを管理します。

## アプリ一覧

- `web-host/`: エンドユーザー向け閲覧サイト (シリーズ/エピソード閲覧)
- `web-admin/`: 出版社・編集者向け入稿/運用管理画面

## 担当機能

- マルチテナント・ブランディング (テーマ、ロゴ、ドメイン別表示)
- カタログ表示・エピソード閲覧体験
- 管理画面での作品/エピソード入稿・公開設定

## 開発コマンド

```bash
# 全アプリ起動
make dev-web

# 個別起動
cd apps/web-host && pnpm dev
cd apps/web-admin && pnpm dev
```
