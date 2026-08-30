# purge-content-events

保持期限を過ぎた `content_events` の行を、全テナントまとめてチャンク DELETE で削除する one-shot バッチです。

閲覧イベントは高頻度に積み上がるため、生イベントは有期限（既定 90 日）で捨て、恒久的な数値は `aggregate-content-stats` が作る `content_daily_stats` 側に残します。個人情報の最小化もこの保持期限が担っています。

`occurred_at < cutoff` の行を古い順に `LIMIT` 付きで取り、1 チャンク 1 トランザクションで削除します。チャンクごとに commit するので、途中で中断しても済んだ分は残り、次回はその続きから進みます。

## 実行

実行ロールには `BYPASSRLS`（または superuser）が必要です。ローカル開発では `task --silent dev-env:env` が出力する `PUBLIRA_CONTENT_STATS_DB_URL` をそのまま使えます。

```bash
eval "$(task --silent dev-env:env)"
PUBLIRA_CONTENT_EVENTS_PURGE_DRY_RUN=true go run ./server/cmd/purge-content-events
```

環境変数:

- `PUBLIRA_CONTENT_EVENTS_DB_URL`: 専用の BYPASSRLS 接続 URL。未設定なら `PUBLIRA_CONTENT_STATS_DB_URL`、`PUBLIRA_WORKER_DB_URL`、`PUBLIRA_DB_URL` の順に使います。`content_events` を扱う 2 つのバッチは同じ `publira_content_stats` ロールで動きます。
- `PUBLIRA_CONTENT_EVENTS_RETENTION_DAYS`: 保持日数。既定は `90`。`1` 未満は起動時にエラーになります（cutoff が現在時刻以降になり、表ごと消えるため）。
- `PUBLIRA_CONTENT_EVENTS_PURGE_CHUNK_SIZE`: 1 回の DELETE の上限行数。既定は `10000`。
- `PUBLIRA_CONTENT_EVENTS_PURGE_DRY_RUN`: `true` で削除対象の件数だけを数えてログに出し、何も削除せず終了します。

cutoff は実行時刻 UTC から `PUBLIRA_CONTENT_EVENTS_RETENTION_DAYS` を引いた時刻で、比較は排他（`occurred_at < cutoff`）です。出力は構造化ログで、cutoff・保持日数・チャンクサイズ・削除件数・チャンク数・所要時間を記録します。

## 実行計画

チャンクの取り出しは `idx_content_events_occurred_at`（`occurred_at` 単独の btree）を使う形です。テナント先頭のインデックスは全テナント横断の走査には効かないため、このバッチのために追加してあります。小規模データでは PostgreSQL が sequential scan を選ぶことがあるため、インデックス適格性を確認するときは `SET enable_seqscan = off` を付けて `EXPLAIN` してください。

## パーティション化の検討トリガ

初期スコープは単一表 + チャンク DELETE です。次のどちらかを観測したら、`content_events` の `occurred_at` による declarative partitioning（`DROP PARTITION` での切り捨て）へ切り替えるかを検討します。

- 1 回の purge が cron の実行間隔に収まらなくなった（所要時間ログで判断）
- 表本体 + インデックスのサイズが VACUUM / autovacuum の追随を明らかに超えた（削除後も肥大が戻らない）
