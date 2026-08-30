# aggregate-content-stats

`content_events` と Phase 0 の `purchases` から、指定した UTC 日の `content_daily_stats` を全テナント分完全再集計する one-shot バッチです。

購入は `purchases` のみを集計します。購入の `content_events` 投影を足さないため、二重計上しません。各 `(tenant_id, stat_date)` は 1 トランザクション内の advisory lock で保護し、既存行を削除してから再作成します。

## 実行

実行ロールには `BYPASSRLS`（または superuser）が必要です。ローカル開発では `task --silent dev-env:env` が出力する `PUBLIRA_CONTENT_STATS_DB_URL` を使います。

```bash
eval "$(task --silent dev-env:env)"
PUBLIRA_CONTENT_STATS_DATE=2026-08-28 go run ./server/cmd/aggregate-content-stats
```

環境変数:

- `PUBLIRA_CONTENT_STATS_DB_URL`: 専用の BYPASSRLS 接続 URL。未設定なら `PUBLIRA_WORKER_DB_URL`、さらに未設定なら `PUBLIRA_DB_URL` を使います。
- `PUBLIRA_CONTENT_STATS_DATE`: `YYYY-MM-DD` の UTC 日付。未設定時は前日 UTC。

出力は構造化ログで、対象日・処理テナント数・作成行数・所要時間を記録します。入力イベントまたは購入があるのに集計結果が空になる場合は、既存 stats を削除して commit せずエラーで終了します。

## 実行計画

イベントの対象日範囲は `idx_content_events_tenant_type_occurred_at`、購入の対象日範囲は `idx_purchases_tenant_purchased_at_episode` を使える形です。小規模データでは PostgreSQL が sequential scan を選ぶことがあるため、インデックス適格性を確認するときは `SET enable_seqscan = off` を付けて `EXPLAIN` してください。
