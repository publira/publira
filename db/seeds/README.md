# SQL Seeds

ローカル開発・画面確認向けの初期データを SQL で管理します。

## 目的

- migration と seed の責務を分離する
- Go 実行環境なしでも DB 初期状態を再現する
- 複数回実行しても壊れない（冪等）

## ディレクトリ構成

- `seed.sql`: seed 実行エントリポイント
- `baseline/`: 開発時に常に必要な最小データ
- `scenarios/`: 将来追加するシナリオ別データ（任意実行）

## 実行順序

`task db:setup` で以下を順に実行します。

1. migration (`db/migrations/`)
2. baseline seed (`db/seeds/baseline/`)

## 基本方針

- スキーマ変更は migration にのみ追加する
- seed は開発用の固定データ・参照データに限定する
- seed は `ON CONFLICT` を使って冪等に保つ

## baseline アカウント

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

## baseline データ件数

- labels: 10 件
- series: 100 件
- episodes: 1000 件（各 series 10 件）

## ID 仕様

- `public_id`: 12 文字・大文字16進（サーバーの `generatePublicID` に準拠）
- `id` (UUID): UUIDv7 形式に準拠した値を使用
