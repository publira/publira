# web-host

テナント公開サイトです。配信カタログ・認証・マイページを単一 Next.js アプリとして提供します。

## 開発

```bash
cd apps/web-host
pnpm dev
```

デフォルトポートは `3000` です。

### サーバーキャッシュ (Redis)

`next.config.ts` で `@publira/next-cache-handlers` を配線しています。

- `cacheHandlers`（複数形）: `"use cache"` / `"use cache: remote"`
- `cacheHandler`（単数）: ISR / Route Handler / `next/image`（`images.customCacheHandler: true`）

環境変数:

- `REDIS_URL`（Dev Container では `redis://redis:6379`）
- `NEXT_CACHE_APP=web-host`（推奨。キー空間分離）

公開時の `revalidateTag`（`/api/revalidate`）は Redis 上のタグ時刻と整合します。

## 含まれる領域

- 公開ページ（プライバシーポリシー、利用規約など）
- カタログ（シリーズ・エピソード・著者・レーベル）
- 認証（ログイン・新規登録・パスワードリセット）
- メンバー（マイページ・お知らせ・設定）
