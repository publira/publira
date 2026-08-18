# web-host

テナント公開サイトです。配信カタログ・認証・マイページを単一 Next.js アプリとして提供します。

## 開発

```bash
cd apps/web-host
pnpm dev
```

デフォルトポートは `3000` です。

### セッション Cookie (JWE)

必須の環境変数:

- `PUBLIRA_AUTH_SECRET`（32 バイト以上）— `publira_web_host_auth` Cookie を封じる鍵。フォールバックは無く、未設定・短すぎる場合は例外になります。詳細と払い出し方は [リポジトリ README](../../README.md#セッション-cookie-の暗号鍵-publira_auth_secret) を参照してください

### サーバーキャッシュ (Redis)

`next.config.ts` で `@publira/next-cache-handlers` を配線しています。

- `cacheHandlers`（複数形）: `"use cache"` / `"use cache: remote"`
- `cacheHandler`（単数）: ISR / Route Handler / `next/image`（`images.customCacheHandler: true`）

環境変数:

- `PUBLIRA_REDIS_URL`（Dev Container では `redis://redis:6379`）
- `PUBLIRA_CACHE_APP=web-host`（推奨。キー空間分離）

公開時の `revalidateTag`（`/api/revalidate`）は Redis 上のタグ時刻と整合します。

### エピソード購入

有料エピソードの「購入手続きへ」は Stripe Checkout へ遷移します。Stripe から戻った後、`checkout.session.completed` Webhook の購入反映が本文画像へのアクセスを許可します。web-host 自身に Stripe の秘密鍵は置きません。公開 API の `PUBLIRA_WEB_HOST_URL` にこのアプリの絶対 URL（例: `http://localhost:3000`）を設定し、Stripe / Webhook の設定手順は [server README](../../server/README.md#stripe-checkoutエピソード購入) を参照してください。

## 含まれる領域

- 公開ページ（プライバシーポリシー、利用規約など）
- カタログ（シリーズ・エピソード・著者・レーベル）
- 認証（ログイン・新規登録・パスワードリセット）
- メンバー（マイページ・お知らせ・設定）
