# web-admin

出版社・編集者がコンテンツを入稿/運用する管理画面です。

## 主な責務

- Series / Episode の登録・編集
- 公開設定 (予約公開を含む)
- テナントごとのブランド設定 (テーマ・ロゴ等)
- テナントごとの Stripe 決済設定 (シークレットの登録・更新・無効化)

## 表示ロケール

- UI ロケールは Cookie `publira_locale`（`Path=/`、`SameSite=Lax`、`Max-Age` 1 年、`httpOnly` なし）に保存する。URL には出さない。ホストが同じならテナントをまたいでも同じ Cookie を使う
- 解決順は Cookie → テナント既定言語 → `ja`。対応していない Cookie 値は未設定と同じ扱いでテナント既定言語に落ちる。未認証画面（ログインなど）は admin API を呼べないので Cookie か `ja` のまま
- 読み取りは `lib/locale.ts` の `getLocale(tenantId?)`。`cookies()` を使うので **`<Suspense>` の内側からのみ**呼ぶ。`"use cache"` の中では呼ばず、locale を引数で渡す。テナント既定言語へのフォールバックは `tenantId` を渡したときだけ行い、渡してもセッションが無ければ `ja` に落ちる
- Server Component はテナント id を `next/root-params` から読む。Server Action ではそれが使えないので、テナント id は自分の入力（フォームの値）から受け取る
- テナント既定言語は `/settings` の「既定言語」カード。`lib/tenant-default-locale.ts` が `"use cache: private"` で読み、保存時に `updateTag` する
- メッセージはリポジトリルートの [`locales/*.json`](../../locales/README.md) を `loadAdminMessages(locale)` が動的 `import()` する
- 画面に文言を出すのは `components/message.tsx` の `<Message>`。呼び出し側が 1 文字列ずつ `<Suspense>` で包み、fallback に `Skeleton` を置く。ロケールとカタログの待ちがこのコンポーネントの中に閉じるので、ナビやページ枠の骨格は静的シェルのまま残る。テナント id はルートセグメントから読むため、Cookie 未設定の操作者にもテナント既定言語で表示される
- `aria-label` や `alt` のように属性へ入る文言はノードとしてストリームできない。`components/admin-brand-logo.tsx` や `components/notification-bell.tsx` のように値を組み立てる側でカタログを解決し、その 1 つのコントロールだけを自前の `<Suspense>` の後ろで待たせる
- `error.tsx` は Client Component なので `<Message>` を使えない。`components/client-message.tsx` の `<ClientMessage>` が `document.cookie` から Cookie を読む。admin API に届かない境界なので、Cookie 未設定のときはテナント既定言語ではなく `ja` になる。`<Message>` と同じく呼び出し側で `<Suspense>` に包むこと。エラー境界の上にはもう境界が無いので、フォールバックの無いまま suspend するとエラー画面自体が流せずレスポンスが途中で切れる
- 文言を受け取る props はカタログのキーではなく `ReactNode` を取る。どの文字列がどの `<Suspense>` の後ろで待つかは渡す側のコードに現れる。`<Suspense>` と `<Message>` を組み立てて返すだけのヘルパーは挟まず、呼び出し側に直接書く。`ErrorScreen` は 4 文言すべてを受け取る（呼び出しは `(protected)/error.tsx` の 1 箇所だけ）
- props にするのは呼び出し側を名指しする文言だけ。`SectionErrorBoundary` が受け取るのはセクション名を含む `title` の 1 つで、対処の案内・再試行ボタン・エラー ID のラベルはどの境界でも同じ文言＝セクションではなくフレームの持ち物なので `components/section-error-boundary.tsx` が自分でカタログから解決する（`@publira/ui-components` の既定は日本語なので、解決しないままだと英語表示の画面に日本語が出る）。`<Message>` が async な Server Component である以上そこはサーバーコンポーネントになるため、`catchError` の呼び出しだけを `components/section-error-catch.tsx`（`"use client"`）に分けてある
- 個人の切替は `/settings` の「表示言語」カード。Server Action `setAdminLocaleAction` が Cookie を書き、同じ往復で画面が再描画される
- `<html lang>` は `[tenant_id]/layout.tsx` の静的属性 + `<head>` のインラインスクリプトで解決する。理由と制約は `packages/utils/README.md` の `LOCALE_LANG_SCRIPT` を参照。`global-not-found.tsx` は layout を通らず本文もロケールに追従できないので `lang="ja"` 固定

## 開発

```bash
cd apps/web-admin
pnpm dev
```

### 内部キャッシュ再検証

`POST /api/v1/revalidate` は Go サーバー専用の再検証入口です。`PUBLIRA_REVALIDATE_TOKEN` を `X-Revalidate-Token` ヘッダーで照合し、受け取ったタグをテナント ID による制限なしに `revalidateTag(tag, "max")` します。このパスは `proxy.ts` の Host によるテナント解決とセッション認証を bypass します。宛先は private network の `PUBLIRA_WEB_ADMIN_INTERNAL_URL` です。

### セッション Cookie (JWE)

必須の環境変数:

- `PUBLIRA_AUTH_SECRET`（32 バイト以上）— 管理画面のセッション Cookie を封じる鍵。フォールバックは無く、未設定・短すぎる場合は例外になります。詳細と払い出し方は [リポジトリ README](../../README.md#セッション-cookie-の暗号鍵-publira_auth_secret) を参照してください

### 画像配信 (`next/image`)

`next.config.ts` の `images.loader: "custom"` / `loaderFile: "./lib/image-loader.ts"` で、`next/image` が admin-image-server の Manael 変換を直接使います。`/images/...` を読むときだけ要求幅を `w` として渡し、WebP / AVIF はブラウザの `Accept` で決まります。`blob:` の一時プレビューなど admin-image-server を経由しない `<Image>` は `unoptimized` のままにしてください。ローダーの実装と仕様は [`packages/utils/README.md`](../../packages/utils/README.md) にあります。
