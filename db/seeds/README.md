# SQL Seeds

ローカル開発・画面確認向けの初期データを SQL で管理します。

## 目的

- migration と seed の責務を分離する
- Go 実行環境なしでも DB 初期状態を再現する
- 複数回実行しても壊れない（冪等）

## ディレクトリ構成

- `prod.sql`: **本番用**エントリポイント — DB ユーザー・ロールのみ
- `dev.sql`: **開発用**エントリポイント — `prod.sql` + 開発用サンプルデータ
- `baseline/`: 環境共通の最小ファイル群（prod / dev 両方から参照）
- `dev/`: 開発環境専用データ（dev.sql からのみ参照）
  - `001_tenant_users.sql`: テナント・ユーザー・ロール
  - `010_catalog.sql`: レーベル・著者・シリーズ・エピソード
  - `020_audit_logs.sql`: 監査ログ
  - `030_smtp_config.sql`: SMTP 設定
- `scenarios/`: 将来追加するシナリオ別データ（任意実行）

## 実行方法

```bash
task db:seed             # 開発用シード（デフォルト: ENV=dev）
task db:seed ENV=prod    # 本番用シード（DBユーザー・ロールのみ）
```

`task db:setup` は `db:migrate` + `db:seed`（dev）を実行します。

## 基本方針

- スキーマ変更は migration にのみ追加する
- seed は開発用の固定データ・参照データに限定する
- seed は `ON CONFLICT` を使って冪等に保つ

## dev サンプルアカウント

- Platform:
  - email: `platform@example.com`
  - password: `platformpass`
- Tenant admin:
  - tenant domain: `localhost`
  - tenant admin domain: `admin.localhost`
  - email: `admin@example.com`
  - password: `adminpass`
- Member user:
  - email: `member@example.com`
  - password: `memberpass`

## baseline ロールとユーザー

`baseline/000_rls_bypass_role.sql` で以下を作成します（冪等）:

| 名前 | 種別 | 用途 |
| --- | --- | --- |
| `publira_rls_bypass` | NOLOGIN, BYPASSRLS | 本番で専用ロールを付与するための名前付き権限 |
| `publira_platform` | LOGIN, BYPASSRLS | platform API 用ログインユーザー。RLS をバイパスして全テナントに横断アクセス |
| `publira_admin` | LOGIN | admin API 用ログインユーザー。RLS 有効（テナントスコープ） |
| `publira_public` | LOGIN | public API 用ログインユーザー。RLS 有効（テナントスコープ） |

開発用パスワードはそれぞれ `platformpass` / `adminpass` / `publicpass` です。  
本番環境では seed 後に `ALTER ROLE ... PASSWORD` で安全な値に変更してください。

## dev データ件数

- labels: 10 件
- series: 100 件
- episodes: 1000 件（各 series 10 件）

## ID 仕様

- `public_id`: 12 文字・大文字16進（サーバーの `generatePublicID` に準拠）
- `id` (UUID): UUIDv7 形式に準拠した値を使用
