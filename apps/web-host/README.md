# web-host

テナント公開サイトです。配信カタログ・認証・マイページを単一 Next.js アプリとして提供します。

## 開発

```bash
cd apps/web-host
pnpm dev
```

デフォルトポートは `3000` です。

### URL とロケール

公開 URL はテナント既定ロケールでは locale 接頭辞なし（`/series/SR01`）、非既定ロケールでは `/{locale}/...`（`/en/series/SR01`）です。`proxy.ts` は Host からテナントを解決し、接頭辞なしの URL をそのテナント既定ロケールとして `/{tenantId}/{locale}{path}` へ内部 rewrite します。既定ロケールを明示した URL は、パスとクエリを保った接頭辞なしの正規 URL へ 307 リダイレクトします。既定ロケールは `GetTenantByDomain` がテナント ID と同じ応答で返すため、判断に追加のラウンドトリップは要りません。

- `/theme.css` と Route Handler（`/api/*`）はロケールの外に置きます。Route Handler は `next/root-params` を読めません
- 個別ページの slug 判定はロケールを外した残りのパスで行うので、`/{locale}/ja` のような slug も公開ページとして解決します
- Server Component は `lib/locale.ts` の `getLocale()`、Client Component は `components/locale-provider.tsx` の `useLocale()`、Server Action は引数か `<LocaleField />` の hidden フィールドからロケールを受け取ります。テナント ID も同じ形で、静的シェルに残るフォームは `components/tenant-id-field.tsx` の `<TenantIdField />` を置きます
- ヘッダの言語切替はパスのロケールだけを差し替えるリンクです。クエリ文字列は引き継ぎません
- サーバー側でテナントの既定ロケールが要るときは `lib/tenant.ts` の `getTenantDefaultLocale()` を使います。`getTenantSiteInfo()` の `defaultLocale` を返すだけの入口で、テナントを読めなければ `ja` になります。`proxy.ts` はここを通りません（レンダリング前で `"use cache"` を読めないため、`GetTenantByDomain` の応答から直接取ります）

### 画面文言

ユーザー向けの文言はリポジトリルートの `locales/{locale}.json` の `host.*` から出します。`lib/messages.ts` の `loadHostMessages(locale)` がカタログを読み、Server Component は `<Message message="host.…" />` を `<Suspense>` + `Skeleton` で包んで 1 文字列ずつ解決します。`aria-label` や `placeholder` のように文字列でなければならない箇所と `generateMetadata` の `title` だけ `getMessage()` を直接呼びます。

- `"use cache"` の中でロケールを読みません。`lib/catalog.ts` などの読み取りは `locale` を引数で受け取り、失敗時の文言をキャッシュキーに含めます
- すでにブロックしているセクション（`searchParams` を読むフォーム、RPC の結果で分岐する一覧）は 1 文字列ずつ `<Suspense>` を置かず、そのセクションの中で `getMessage()` を呼びます。静的シェルに届かない文言に境界を足しても待ち時間は減りません
- Client Component にはカタログではなく解決済みの文字列（`copy` プロップ）かノードを渡します。`error.tsx` だけは `components/client-message.tsx` の `<ClientMessage>` でブラウザ側から引きます
- テナントが書いた作品タイトル・あらすじ・本文・個別ページの中身は翻訳しません。ロケールを変えても原文のまま出ます
- テナント名が未設定のときの代替表記は `lib/tenant.ts` の `getTenantSiteLabel(tenantId, locale)` が返します

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

公開時の `revalidateTag`（内部専用の `POST /api/v1/revalidate`）は Redis 上のタグ時刻と整合します。`PUBLIRA_REVALIDATE_TOKEN` が共有トークンを認証し、このパスは `proxy.ts` による Host ベースのテナント解決を通りません。タグはテナント ID による制限なしにそのまま再検証され、Go サーバーは `PUBLIRA_WEB_HOST_INTERNAL_URL` でこのアプリへ直接到達します。

### 分散トレーシング

`instrumentation.ts` が `@publira/tracing` の `registerTracing("publira-web-host")` を呼び、Next.js の inbound span と SSR からの Connect RPC の client span を出します。既定は無効で、`PUBLIRA_TRACING_ENABLED` を立てたときだけ登録します。Dev Container では Jaeger UI (`http://localhost:16686`) の Service `publira-web-host` で確認できます。

環境変数と `NEXT_OTEL_VERBOSE` の扱いは [`packages/tracing/README.md`](../../packages/tracing/README.md) を参照してください。

### テーマ CSS の更新確認

`/theme.css` は `tenant:{id}:theme` を持つ専用の `"use cache"` 読取です。テーマ保存時に admin API がこのタグを再検証するため、公開サイトのテーマ更新が site chrome のキャッシュタグに依存しません。アイコン／ロゴを更新した場合は、テーマタグと `tenant:{id}:site` の両方を再検証します。

手動確認は、テーマの色を保存後に公開ドメインの `GET /theme.css` を確認します。既存のブラウザ／共有キャッシュは `Cache-Control` の短い TTL（`max-age=30`, `s-maxage=30`, `stale-while-revalidate=60`）までは旧レスポンスを返せるため、DevTools のキャッシュ無効化を使うか TTL の経過後に再読み込みしてください。レスポンス内の `--publira-color-primary` などが保存した色へ変わることを確認します。失敗した再検証は admin API の `failed to request next revalidate after theme upsert` ログに tenant ID・ドメイン・タグとともに記録されます。

### 画像配信 (`next/image`)

`next.config.ts` の `images.loader: "custom"` / `loaderFile: "./lib/image-loader.ts"` で、`next/image` が image-server の Manael 変換を直接使います。`/images/...` を読むときだけ要求幅を `w` として渡し、WebP / AVIF はブラウザの `Accept` で決まります。`blob:` の一時プレビューなど image-server を経由しない `<Image>` は `unoptimized` のままにしてください。ローダーの実装と仕様は [`packages/utils/README.md`](../../packages/utils/README.md) にあります。

### エピソードビューア (Canvas)

エピソード本文は `@publira/comic-viewer` が Canvas に描画します。`<img>` を出さないので、本文画像はドラッグ保存も右クリック保存もできません。ページの取得・デコード・先読みはこのライブラリのパイプラインが持ちます。

- 本文画像は `next/image` を通りません。image-server の配信 URL（メディアトークン付き）をそのままページの `src` に渡します
- ページの取得はビューアのプラグイン（`_lib/viewer-fetch.ts`）が `Accept` を付けて行います。ビューアは `fetch()` でページを取るので既定では `Accept` が効かず、Manael は変換しないと縮小もしないため、これが無いと常に原寸の元画像が落ちてきます
- `X-Publira-Image-Encryption: xor-hmac-sha256-v1` の応答は、URL の短命メディア JWT（`t`）と `sub`、`X-Publira-Image-Key-Id` から同じストリームを復元してブラウザ内で復号します。復号後の MIME type は `X-Publira-Image-Content-Type` を使い、`@publira/comic-viewer` の Canvas パイプラインだけへ渡します。暗号化されない公開画像は従来どおりそのまま描画します
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
