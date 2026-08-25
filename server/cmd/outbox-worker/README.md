# outbox-worker

Outbox を drain して River ジョブとして処理する常駐ワーカーです。API プロセスとは別プロセスで動きます。初版のハンドラはテストイベント `outbox_test` だけです。業務イベント（招待メールなど）は後続 Issue で登録します。

## 起動

リポジトリルートから:

```bash
task server:dev-outbox-worker
```

`server` ディレクトリから:

```bash
go run ./cmd/outbox-worker
```

ビルド済みバイナリを使う場合:

```bash
task server:build
./server/bin/outbox-worker
```

本番イメージは API ロール（常駐 HTTP）です。

```bash
task docker:build:api CMD_NAME=outbox-worker PORT=8003
```

## 主な環境変数

接続先は **BYPASSRLS 相当**のロールである必要があります。テナント RLS が付いた `publira_admin` / `publira_public` では pending 行を横断 claim できません。

- `PUBLIRA_WORKER_DB_URL` (任意, 未指定時は `PUBLIRA_DB_URL`、それも無ければ開発用デフォルト `postgres://postgres:password@db:5432/publira?sslmode=disable`)
- `PUBLIRA_WORKER_ADDR` (任意, 既定 `:8003`。`/livez` と `/readyz`)
- `PUBLIRA_OUTBOX_DRAIN_INTERVAL` (任意, Go duration。既定 `2s`)
- `PUBLIRA_OUTBOX_CLAIM_LIMIT` (任意, 1 drain で claim する最大行数。既定 `100`)
- `PUBLIRA_OUTBOX_MAX_ATTEMPTS` (任意, 既定 `10`。到達した失敗で `dead`)
- `PUBLIRA_OUTBOX_STALE_PROCESSING` (任意, Go duration。既定 `15m`。この時間より古い `processing` を `pending` に戻す)
- `PUBLIRA_OUTBOX_MAX_WORKERS` (任意, River の default キュー並列数。既定 `8`)
- `PUBLIRA_TRACING_ENABLED` (任意, 既定は無効)
- `PUBLIRA_DEPLOYMENT_ENVIRONMENT` (任意, 未指定時 `development`)

トレースの属性・span 命名・サンプリング・`OTEL_*` の一覧は [server/README.md](../../README.md#分散トレーシング-opentelemetry) にあります。

起動時に River のスキーマ（`river_job` など）を `rivermigrate` で適用します。アプリケーションの baseline マイグレーションには含めていません。

## ログとメトリクス

構造化ログ（slog）に `event_id` / `event_type` / `idempotency_key` / `attempts` を付けます。OpenTelemetry のカウンタ:

- `publira.outbox.events.claimed`
- `publira.outbox.events.done`
- `publira.outbox.events.retry`
- `publira.outbox.events.dead`
- `publira.outbox.handler.duration`（histogram, 秒）

MeterProvider が無いときは no-op です。プロセス内カウンタはテストが読みます。

## 処理の流れ

1. 期限の来た `pending` を `FOR UPDATE SKIP LOCKED` で claim し、同一 TX で River ジョブを投入する
2. ジョブがハンドラを実行し、成功なら `done`、失敗なら指数バックオフで `pending` に戻す
3. 最大試行回数または永続エラーで `dead`
4. プロセス再起動後は未処理の `pending` と、古くなった `processing` を拾い直す
