# web-platform

プラットフォーム運営者向けの横断オペレーション画面です。テナント内運用を担う web-admin とは責務を分離します。

## この Issue で固定した情報設計

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

### セッション失効時の再認証 (#607)

方針の正は Epic [#65](https://github.com/publira/publira/issues/65)。web-admin ([#605](https://github.com/publira/publira/issues/605)) と同じ形をこのアプリにも入れています。

| 失効の入口 | 経路 |
| --- | --- |
| Cookie 欠落 / 復号失敗 / 期限切れ | `proxy.ts` が Cookie を削除し `buildLoginUrl` で `/login?next=` へ |
| 画面が待つ読み取りが `Unauthenticated` | 読み取りが `requiresSignIn` を値で返し、キャッシュ外で `redirectToLoginIfSessionRejected()` が redirect |
| Server Action の RPC が `Unauthenticated` | `lib/` の mutation が throw し、`withPlatformSessionReauth()` が redirect |

- 戻り先は `proxy.ts` が保護ルートのリクエストに載せる `x-publira-return-to` を `lib/auth-session.ts` が読み直します。ページもレイアウトも Server Action も自分が処理している URL を読めないため、クエリ文字列ごと 1 か所で決めています。
- レンダリング中は Cookie を消せない（`cookies().delete()` は Server Function / Route Handler 専用）ので、redirect に `reason=session_revoked` を付け、続く `/login` のリクエストで proxy が Cookie を落とします。このマーカーが無いと、他端末での `credentials_version` 更新で失効した Cookie が復号でき期限内のまま残り、保護ルート → redirect → 保護ルートのループになります。同じマーカーがログイン画面のフラッシュ文言にもなります。
- 再認証扱いにするのは Connect の `Unauthenticated` だけです。現在のパスワード誤りのようなビジネスエラーはフォームのメッセージのままで、ログアウトさせません。

### 共通レイアウト (アプリシェル)

- 左: サイドバー (主要導線 + 責務分離メモ)
- 上: ヘッダー (現在のオペレーター情報 + 主要アクション)
- 本文: `PlatformPage` でページヘッダーと本文コンテナを統一
- モバイル: サイドバーをドロワーとして再利用

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
