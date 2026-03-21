# apps

Web フロントエンド群です。Turborepo 上で Next.js アプリをマイクロフロントエンド構成で管理します。

## アプリ一覧

| アプリ          | ポート | 用途                                                                                              |
| --------------- | ------ | ------------------------------------------------------------------------------------------------- |
| `web-public/`   | 3000   | 認証状態に関わらず常に同じコンテンツを返す公開ページ (トップ、プライバシーポリシー、利用規約など) |
| `web-catalog/`  | 3001   | シリーズ・エピソード・著者など認証状態によって表示内容が変わるコンテンツページ                    |
| `web-member/`   | 3002   | マイページ・通知など認証ユーザー専用ページ                                                        |
| `web-auth/`     | 3003   | ログイン・新規登録・パスワードリセットなど認証ページ                                              |
| `web-admin/`    | 4000   | 出版社・編集者向け入稿/運用管理画面                                                               |
| `web-platform/` | 4100   | プラットフォーム運営者向けテナント横断オペレーション画面                                          |

## 開発コマンド

```bash
# 全アプリ起動
make dev-web

# 個別起動
cd apps/web-public  && pnpm dev
cd apps/web-catalog && pnpm dev
cd apps/web-member  && pnpm dev
cd apps/web-auth    && pnpm dev
cd apps/web-admin   && pnpm dev
cd apps/web-platform && pnpm dev
```
