# apps

Web フロントエンド群です。Turborepo 上でホスト単位の Next.js アプリを管理します。

## アプリ一覧

| アプリ          | ポート | 用途                                                             |
| --------------- | ------ | ---------------------------------------------------------------- |
| `web-host/`     | 3000   | テナント公開サイト（カタログ・認証・マイページ・静的公開ページ） |
| `web-admin/`    | 4000   | 出版社・編集者向け入稿/運用管理画面                              |
| `web-platform/` | 4100   | プラットフォーム運営者向けテナント横断オペレーション画面         |

## 開発コマンド

```bash
# 全アプリ起動
task server:dev-web

# 個別起動
cd apps/web-host     && pnpm dev
cd apps/web-admin    && pnpm dev
cd apps/web-platform && pnpm dev
```
