# web-host

テナント公開サイトです。配信カタログ・認証・マイページを単一 Next.js アプリとして提供します。

## 開発

```bash
cd apps/web-host
pnpm dev
```

デフォルトポートは `3000` です。

### URL とロケール

公開 URL は `/{locale}/...` です（`ja` / `en`）。`proxy.ts` が Host からテナントを解決し、`/{tenantId}/{locale}{path}` へ rewrite します。ロケールの無い URL は**そのテナントの既定ロケール**へ 307 でリダイレクトするので、プレフィックス導入前のブックマークもそのまま開けます。既定ロケールは `GetTenantByDomain` がテナント ID と同じ応答で返すため、リダイレクトの判断に追加のラウンドトリップは要りません。

- `/theme.css` と Route Handler（`/api/*`）はロケールの外に置きます。Route Handler は `next/root-params` を読めません
- 個別ページの slug 判定はロケールを外した残りのパスで行うので、`/{locale}/ja` のような slug も公開ページとして解決します
- Server Component は `lib/locale.ts` の `getLocale()`、Client Component は `components/locale-provider.tsx` の `useLocale()`、Server Action は引数か `<LocaleField />` の hidden フィールドからロケールを受け取ります
- ヘッダの言語切替はパスのロケールだけを差し替えるリンクです。クエリ文字列は引き継ぎません

### セッション Cookie (JWE)

必須の環境変数:

- `PUBLIRA_AUTH_SECRET`（32 バイト以上）— `publira_web_host_auth` Cookie を封じる鍵。フォールバックは無く、未設定・短すぎる場合は例外になります。詳細と払い出し方は [リポジトリ README](../../README.md#セッション-cookie-の暗号鍵-publira_auth_secret) を参照してください

### サーバーキャッシュ (Redis)

`next.config.ts` で `@publira/next-cache-handlers` を配線しています。

- `cacheHandlers`（複数形）: `"use cache"` / `"use cache: remote"`
- `cacheHandler`（単数）: ISR / Route Handler / `fetch` / `unstable_cache`

環境変数:

- `PUBLIRA_REDIS_URL`（Dev Container では `redis://redis:6379`）
- `PUBLIRA_CACHE_APP=web-host`（推奨。キー空間分離）

公開時の `revalidateTag`（`/api/revalidate`）は Redis 上のタグ時刻と整合します。

### 画像配信 (`next/image`)

`next.config.ts` の `images.loader: "custom"` / `loaderFile: "./lib/image-loader.ts"` で、`next/image` が image-server の Manael 変換を直接使います。`/images/...` を読むときだけ要求幅を `w` として渡し、WebP / AVIF はブラウザの `Accept` で決まります。`blob:` の一時プレビューなど image-server を経由しない `<Image>` は `unoptimized` のままにしてください。ローダーの実装と仕様は [`packages/utils/README.md`](../../packages/utils/README.md) にあります。

### エピソードビューア (Canvas)

エピソード本文は `@publira/comic-viewer` が Canvas に描画します。`<img>` を出さないので、本文画像はドラッグ保存も右クリック保存もできません。ページの取得・デコード・先読みはこのライブラリのパイプラインが持ちます。

- 本文画像は `next/image` を通りません。image-server の配信 URL（メディアトークン付き）をそのままページの `src` に渡します
- ページの取得はビューアのプラグイン（`_lib/viewer-fetch.ts`）が `Accept` を付けて行います。ビューアは `fetch()` でページを取るので既定では `Accept` が効かず、Manael は変換しないと縮小もしないため、これが無いと常に原寸の元画像が落ちてきます
- 画面上の操作はページ送りと全画面だけで、どちらもビューアのツールバー側にあり、読者が静止すると自動的に隠れます。拡大はピンチ、リセットは 1 本指ダブルタップで、いずれもライブラリ側のジェスチャです
- 綴じ方向はライブラリ既定の右開き。見開きは `spreadStartIndex` を `1` にして、表紙を単独で見せてから 2–3 ページ目以降を組みます
- ページ単位の読み込み失敗はビューア内で `再読み込み` を出し、そのページだけ再試行します。エピソード全体は落としません
- ビューアの高さは `_lib/viewer-layout.ts` の `VIEWER_HEIGHT_CLASS` が持ち、本文のスケルトンが同じ箱を予約します。下に続くエピソード情報が初回描画から動きません

### サイトアイコン (`rel="icon"` / apple-touch-icon)

`link rel="icon"` と `link rel="apple-touch-icon"` は、テナントアイコンが設定されていればその配信 URL（`/images/tenants/{media_id}/icon`）を指します。画像は image-server が配り、正方形の PNG への整形はアップロード時にサーバー側で済んでいるため、web-host 側での変換はありません。未設定のテナントではアイコンを宣言せず、ブラウザの既定に任せます。

### サイトロゴ（ヘッダ）

テナントロゴが設定されていれば、公開サイトヘッダのブランド領域にその配信 URL（`/images/tenants/{media_id}/logo`）を表示します。未設定・空 URL・読み込み失敗はいずれも既存のサイト名テキストにフォールバックします。

### エピソード購入

有料エピソードの「購入手続きへ」は Stripe Checkout へ遷移します。Stripe から戻った後、`checkout.session.completed` Webhook の購入反映が本文画像へのアクセスを許可します。web-host 自身に Stripe の秘密鍵は置きません。戻り先と Webhook はテナントの公開ドメインで受け、手順は [server README](../../server/README.md#stripe-checkoutエピソード購入) を参照してください。

## 含まれる領域

- 公開ページ（プライバシーポリシー、利用規約など）
- カタログ（シリーズ・エピソード・著者・レーベル）
- 認証（ログイン・新規登録・パスワードリセット）
- メンバー（マイページ・お知らせ・設定）
