# web-platform

プラットフォーム運営者向けの横断オペレーション画面です。テナント内運用を担う web-admin とは責務を分離します。

## 情報設計

### ルート構成

| ルート | 画面 | 目的 | 認証 |
| --- | --- | --- | --- |
| `/login` | ログイン | platform operator の入口 | 不要 |
| `/` | ダッシュボード | 横断 KPI / 直近イベント確認 | 必須 |
| `/tenants` | テナント一覧 | テナント横断の状態一覧 | 必須 |
| `/tenants/new` | テナント作成 | 新規テナント発行 | 必須 |
| `/tenants/[tenant_id]` | テナント詳細 | 個別テナント状態・契約情報確認 | 必須 |
| `/operators` | オペレーター管理 | 運用者ロール管理 | 必須 |
| `/audit-logs` | 監査ログ | 変更履歴の追跡 | 必須 |

### 認証・認可の前提

- `proxy.ts` で `PUBLIC_PATHS`（`/login`, `/livez`, `/readyz`, `/confirm-email`, `/confirm-password`, `/reset-password`, `/reset-password/requested`, `/setup`）に含まれないパスを保護対象にする
- `/logout` は廃止済み。GET / POST とも 404 を返し、セッション Cookie は変更しない。ログアウトはヘッダーの Server Action のみ
- セッション Cookie: `publira_web_platform_auth`
- 初期ロール定義: `platform_owner`, `platform_operator`, `platform_auditor`
- 画面ガードは `(protected)/layout.tsx` で行う

### 共通レイアウト (アプリシェル)

- 左: サイドバー (主要導線 + 責務分離メモ)
- 上: ヘッダー (現在のオペレーター情報 + 主要アクション)
- 本文: `PlatformPage` でページヘッダーと本文コンテナを統一
- モバイル: サイドバーをドロワーとして再利用

### 表示ロケール

- UI ロケールは Cookie `publira_locale`（`Path=/`、`SameSite=Lax`、`Max-Age` 1 年、`httpOnly` なし）に保存する。URL には出さない
- 解決順は Cookie → プラットフォーム既定言語 → `ja`。対応する Cookie が入っていればそれが常に勝ち、未設定・未知の値だけが既定言語に落ちる。既定言語の読み取り自体が失敗する場合（ログイン画面などセッションがない場合を含む）は `ja`
- 読み取りは `lib/locale.ts` の `getPlatformLocale()`。`cookies()` を使うので **`<Suspense>` の内側からのみ**呼ぶ。`"use cache"` の中では呼ばず、locale を引数で渡す
- メッセージはリポジトリルートの [`locales/*.json`](../../locales/README.md) を `loadPlatformMessages(locale)` が動的 `import()` する。このアプリの画面文言は `platform.*` 名前空間に置く
- 画面文言は `components/message.tsx` の `<Message message="platform.auth.login.submit" />` を `<Suspense>` で包んで 1 文字列ずつ描く。fallback はその文字列に合わせた `SkeletonLine` にする。周りのカードや入力欄は静的シェルに残る
- RPC や `searchParams` の結果で分岐するセクション（`/setup` のゲート、`/confirm-email` の確認結果など）は、分岐で決めるのは `PlatformMessageKey` までにして、描画は `<Message>` に通す。カタログ（`messages`）をプロップで子に渡さない
- Client Component にはカタログではなく描画済みノードを `copy` プロップ（`LoginFormCopy` など）で渡す。Client 側でカタログを `import()` すると両ロケールがブラウザに載る
- `placeholder` などの属性はノードにできないので、その属性を持つコントロール自体がカタログを待つ。コントロール 1 つぶんの `<Suspense>` で囲み、fallback はその高さの `Skeleton` にする（`/setup` の `NameInput`）
- `getMessage` を直に使うのは、ノードにできない値だけ（`generateMetadata` の `title` と Server Action 側）
- ユーザーに見えるメッセージを持つ zod スキーマは、モジュール定数ではなくカタログを受け取る関数にする（`lib/auth-input.ts` の `emailFormSchema(messages)`）。文言はリクエストのロケールで決まるので、Server Action か Suspense の内側でしか解決できない
- `Suspense` の fallback は静的シェルの一部なのでロケールに追従できない。fallback に文章を書かず、その文字列に合わせたサイズの `Skeleton` を出す
- 文言を props にするのは呼び出し側を名指しする文言だけ。`SectionErrorBoundary` が受け取るのはセクション名を含む `title` の 1 つで、対処の案内・再試行ボタン・エラー ID のラベルはどの境界でも同じ文言＝セクションではなくフレームの持ち物なので `components/section-error-boundary.tsx` が自分でカタログから解決する（`@publira/ui-components` の既定は日本語なので、解決しないままだと英語表示の画面に日本語が出る）。`<Message>` が async な Server Component である以上そこはサーバーコンポーネントになるため、`catchError` の呼び出しだけを `components/section-error-catch.tsx`（`"use client"`）に分けてある。`ErrorScreen` は 4 文言すべてを受け取る（呼び出しは `app/error.tsx` と `(protected)/error.tsx` で、どちらも重複していない）
- 切替は `/settings/general` の「表示言語」カード。Server Action `setPlatformLocaleAction` が Cookie を書き、同じ往復で画面が再描画される
- プラットフォーム既定言語は同じ画面の「既定言語」カード（`lib/platform-settings.ts` の `getPlatformSettings` / `updatePlatformDefaultLocale`）。新規テナントの初期言語でもある。保存すると Server Action が `platform:settings` タグを `updateTag` するので、同じセッションの Cookie なし表示にも即反映される
- `<html lang>` はルート layout の静的属性 + `<head>` のインラインスクリプトで解決する。理由と制約は `packages/utils/README.md` の `LOCALE_LANG_SCRIPT` を参照。`global-not-found.tsx` は layout を通らず本文もロケールに追従できないので `lang="ja"` 固定

### web-admin との役割分担

- web-platform: テナント横断オペレーション
  - テナント作成/状態管理
  - オペレーター管理
  - 監査ログ確認
- web-admin: テナント内オペレーション
  - Series / Episode 入稿
  - 公開設定
  - テナント内ブランド設定

## 開発

```bash
cd apps/web-platform
pnpm dev
```

### 内部キャッシュ再検証

`POST /api/v1/revalidate` は Go サーバー専用の再検証入口です。`PUBLIRA_REVALIDATE_TOKEN` を `X-Revalidate-Token` ヘッダーで照合し、受け取ったタグをテナント ID による制限なしに `revalidateTag(tag, "max")` します。このパスは `proxy.ts` のセットアップ確認とセッション認証を bypass します。宛先は private network の `PUBLIRA_WEB_PLATFORM_INTERNAL_URL` です。

### 分散トレーシング

`instrumentation.ts` が `@publira/tracing` の `registerTracing("publira-web-platform")` を呼び、Next.js の inbound span と SSR からの Connect RPC の client span を出します。既定は無効で、`PUBLIRA_TRACING_ENABLED` を立てたときだけ登録します。Dev Container では Jaeger UI (`http://localhost:16686`) の Service `publira-web-platform` で確認できます。

環境変数と `NEXT_OTEL_VERBOSE` の扱いは [`packages/tracing/README.md`](../../packages/tracing/README.md) を参照してください。

### セッション Cookie (JWE)

必須の環境変数:

- `PUBLIRA_AUTH_SECRET`（32 バイト以上）— プラットフォーム管理のセッション Cookie を封じる鍵。フォールバックは無く、未設定・短すぎる場合は例外になります。詳細と払い出し方は [リポジトリ README](../../README.md#セッション-cookie-の暗号鍵-publira_auth_secret) を参照してください
