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
- 画面はカタログを Server Component 側で引き、Client Component には解決済みの文字列を `copy` プロップで渡す（`LoginFormCopy` など）。Client 側でカタログを読み込まない
- ユーザーに見えるメッセージを持つ zod スキーマは、モジュール定数ではなくカタログを受け取る関数にする（`lib/auth-input.ts` の `emailFormSchema(messages)`）。文言はリクエストのロケールで決まるので、Server Action か Suspense の内側でしか解決できない
- `Suspense` の fallback は静的シェルの一部なのでロケールに追従できない。文言を待つ間は `Skeleton` を出し、fallback に文章を書かない
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

### セッション Cookie (JWE)

必須の環境変数:

- `PUBLIRA_AUTH_SECRET`（32 バイト以上）— プラットフォーム管理のセッション Cookie を封じる鍵。フォールバックは無く、未設定・短すぎる場合は例外になります。詳細と払い出し方は [リポジトリ README](../../README.md#セッション-cookie-の暗号鍵-publira_auth_secret) を参照してください
