# web-admin

出版社・編集者がコンテンツを入稿/運用する管理画面です。

## 主な責務

- Series / Episode の登録・編集
- 公開設定 (予約公開を含む)
- テナントごとのブランド設定 (テーマ・ロゴ等)

## 表示ロケール

- UI ロケールは Cookie `publira_locale`（`Path=/`、`SameSite=Lax`、`Max-Age` 1 年、`httpOnly` なし）に保存する。URL には出さない。ホストが同じならテナントをまたいでも同じ Cookie を使う
- 未設定・未知の値は `ja` に落ちる（`@publira/utils/i18n` の `parseLocaleCookie`）
- 読み取りは `lib/locale.ts` の `getLocale()`。`cookies()` を使うので **`<Suspense>` の内側からのみ**呼ぶ。`"use cache"` の中では呼ばず、locale を引数で渡す。Server Actions は `cookies()` を直接読む
- メッセージはリポジトリルートの [`locales/*.json`](../../locales/README.md) を `loadAdminMessages(locale)` が動的 `import()` する
- 切替は `/settings` の「表示言語」カード。Server Action `setAdminLocaleAction` が Cookie を書き、同じ往復で画面が再描画される
- `<html lang>` は `[tenant_id]/layout.tsx` の静的属性 + `<head>` のインラインスクリプトで解決する。理由と制約は `packages/utils/README.md` の `LOCALE_LANG_SCRIPT` を参照。`global-not-found.tsx` は layout を通らず本文もロケールに追従できないので `lang="ja"` 固定

## 開発

```bash
cd apps/web-admin
pnpm dev
```

### セッション Cookie (JWE)

必須の環境変数:

- `PUBLIRA_AUTH_SECRET`（32 バイト以上）— 管理画面のセッション Cookie を封じる鍵。フォールバックは無く、未設定・短すぎる場合は例外になります。詳細と払い出し方は [リポジトリ README](../../README.md#セッション-cookie-の暗号鍵-publira_auth_secret) を参照してください

### 画像配信 (`next/image`)

`next.config.ts` の `images.loader: "custom"` / `loaderFile: "./lib/image-loader.ts"` で、`next/image` が admin-image-server の Manael 変換を直接使います。`/images/...` を読むときだけ要求幅を `w` として渡し、WebP / AVIF はブラウザの `Accept` で決まります。`blob:` の一時プレビューなど admin-image-server を経由しない `<Image>` は `unoptimized` のままにしてください。ローダーの実装と仕様は [`packages/utils/README.md`](../../packages/utils/README.md) にあります。
