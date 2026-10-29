---
title: 監視
description: /livezと/readyzによる各プロセスの監視、アラートを設定すべきログとメトリクス、OpenTelemetryのメトリクスとトレースの有効化を説明します。
published: 2026-10-29
source_updated: 2026-10-28
---

Publiraは、次の4つの方法で稼働状況を知らせます。

- どのプロセスも、死活確認と準備状態の確認のリクエストに応答します。
- `publira server`と`publira worker`は、構造化ログを出力します。
- 同じ2つのプロセスは、有効にするとOpenTelemetryのメトリクスをエクスポートします。
- `email-renderer`以外のすべてのプロセスは、OpenTelemetryのトレースをエクスポートできます。

このページでは、それぞれが何を報告するか、オーケストレーターやアラートの仕組みとどう連携させるか、何にアラートを設定すべきかを説明します。受け取る監視システムは自由に選べます。このページで扱うのは、Publiraが送る情報だけです。

変数の詳細は、[`publira server`と`publira worker`のリファレンス](https://github.com/publira/publira/blob/main/server/cmd/publira/README.md)、[サーバーのトレースとメトリクスのリファレンス](https://github.com/publira/publira/blob/main/server/README.md#distributed-tracing-opentelemetry)、[Webアプリのトレースのリファレンス](https://github.com/publira/publira/blob/main/packages/tracing/README.md)にあります。このページでは繰り返さず、リンクだけを示します。

## ヘルスチェック

どのプロセスも、プレーンなHTTPで次の2つのリクエストに応答します。

- 「**`GET /livez`**」は、プロセスが応答できる状態であれば常に`200`とテキスト`ok`を返します。ほかには何も確認しないので、失敗するのはプロセスが固まったか停止したときだけです。
- 「**`GET /readyz`**」は、プロセスが依存するものを確認し、すべてのチェックに通れば`200`を、1つでも失敗すれば`503`を返します。レスポンスの本文には各チェックの名前が入ります。

| プロセス | ポート | `/readyz`で確認するもの |
| --- | --- | --- |
| `publira server` | `8000`(`PUBLIRA_PUBLIC_API_ADDR`) | `db.public`、`db.admin`、`db.platform`の3つのデータベースログイン。`--role`を指定した場合は、そのロールが使うログインです。[リードレプリカ](../2-deployments/7-scaling-out.md#レプリカから読み取る)を設定している場合は`db.public.replica`も確認します |
| `publira worker` | `8003`(`PUBLIRA_WORKER_ADDR`) | `db.outbox`、`db.ticker`、`db.content_stats`の3つのデータベースログイン。`--queue`を指定した場合は、そのキューが使うログインです。`maintenance`キューを受け持ち、[リードレプリカ](../2-deployments/7-scaling-out.md#日次の再構築)を設定している場合は`db.content_stats.replica`も確認します。また、ジョブキューが動き出すまでは準備ができていないと応答します |
| `web-storefront`、`web-admin`、`web-platform` | `PORT`(リポジトリでビルドしたイメージでは`3000`、`4000`、`4100`) | `api`は、`PUBLIRA_GRPC_URL`のホストにある`publira server`の`/readyz`を確認します。`web-admin`で`PUBLIRA_PUBLIC_GRPC_URL`を設定している場合は、`public-api`がそのホストで同じ確認をします。`redis`は`PNCH_REDIS_URL`の共有キャッシュにpingを送ります。共有キャッシュを無効にしている間は常に成功します |
| `email-renderer` | `8080`(`PORT`) | なし。ほかのサービスに依存しないので、起動していれば常に準備ができています |

`publira server --with-worker`で動かすプロセスは、表の最初の2行にある両方のポートで、それぞれの行のチェックに応答します。2つのプロセスがあるものとして監視してください。

どのプロセスも、オブジェクトストレージ、SMTPサーバー、検索エンジンは確認しません。これらの障害は`/readyz`には現れず、ログと読者に見える画面に現れます。

正常な場合のレスポンスは次のとおりです。

```json
{
  "status": "ok",
  "checks": {
    "db.outbox": { "status": "ok" },
    "db.ticker": { "status": "ok" },
    "db.content_stats": { "status": "ok" }
  }
}
```

`status`は、すべてのチェックに通れば`ok`、1つでも失敗すれば`unavailable`、ワーカーのジョブキューがまだ動き出していない間は`starting`になります。失敗したチェックには`error`が付きます。`error`が示すのは失敗の種類(`timeout`、`dependency_failed`、`not configured`)だけで、ホスト名や接続文字列は含まないので、このレスポンスは誰に見せても問題ありません。失敗の理由そのものは、チェック名を含む`readiness check failed`という行としてプロセスのログに出力されます。

各チェックの制限時間は2秒です。`publira server`と`publira worker`はチェックを1つずつ順番に実行するので、すべてのログインが応答しないときはレスポンスにおよそ6秒かかります。Webアプリはチェックを並行して実行し、およそ2秒以内に応答します。

### オーケストレーターからのプローブ

すべてのプロセスで、liveness probeは`/livez`に、readiness probeは`/readyz`に向けてください。`/readyz`をliveness probeに使ってはいけません。データベースが応答しなくなっただけで、オーケストレーターがすべてのプロセスを一斉に再起動してしまいます。再起動してもデータベースは戻らず、プロセスがキャッシュからまだ提供できていた内容まで提供できなくなります。

Webアプリの`/readyz`は、`publira server`の`/readyz`が失敗すると必ず失敗します。そのため、データベースログインが1つ応答しなくなるだけで、`publira server`とともにすべてのWebアプリが準備できていない状態になります。これは意図した動作です。正常なAPIに到達できないWebアプリは、キャッシュされていないページを表示できないからです。ただしその結果、準備状態に従って振り分けるロードバランサーは、すべてのWebアプリへの送信を一斉に止めます。ロードバランサーを`/readyz`に向ける前に、その動作で問題ないかを判断してください。

`publira server`と`publira worker`の`/readyz`へのプローブには、6秒より長いタイムアウトを設定してください。そうすれば、遅いチェックはプローブのタイムアウトとしてではなく、チェック名の付いた失敗として報告されます。Kubernetesでのワーカーのプローブは次のようになります。すべてのプロセスのプローブは[Kubernetes](../2-deployments/5-kubernetes/index.md#4-プロセスを起動する)に載っています。

```yaml
livenessProbe:
  httpGet:
    path: /livez
    port: 8003
readinessProbe:
  httpGet:
    path: /readyz
    port: 8003
  timeoutSeconds: 8
```

ECSでは、サービスのタスクのヘルスチェックはすべてliveness probeとして働きます。ヘルスチェックに失敗したタスクは、サービスによって置き換えられるからです。そのため[ECSのヘルスチェックの設定](../2-deployments/6-ecs-fargate/index.md#ヘルスチェック)では、すべてを`/livez`に向けています。

[Docker Compose](../2-deployments/3-docker-compose.md)の構成では、Publiraのすべてのプロセスに`/readyz`を使うヘルスチェックを設定しています。チェックはコンテナの中から行います。起動後の最初の1分間は2秒ごとに確認し、この間の失敗は数えません。その後は10秒ごとに確認し、3回続けて失敗するとそのプロセスは`unhealthy`になります。`server`は両方のポートで確認します。結果は`docker compose ps`で各サービスの横に表示されます。Webアプリは`server`とValkeyが正常になってから起動し、プロキシは`server`、`web-storefront`、`web-admin`が正常になってから起動します。イメージ自体にはDockerの`HEALTHCHECK`を定義していません。どのイメージにも`curl`が入っていないので、Composeファイルでは、サーバーのイメージでは`bash`、それ以外のイメージでは`node`でチェックしています。

これらの結果をもとにプロセスを再起動する仕組みはありません。Composeが再起動するのは終了したプロセスで、固まったプロセスや`unhealthy`になったプロセスは再起動しません。結果は、そのプロセスを待つサービスの起動を待たせるためだけに使います。こうした状態に気づくには、コンテナのネットワークに到達できる外部の監視ツールからPubliraを監視するか、`docker compose ps`を確認してください。テナントのサイトの`/livez`と`/readyz`には、`https://comics.example.com/readyz`のように各テナントのドメインでリバースプロキシを通して到達できるので、インターネット上の死活監視サービスから利用できます。APIとワーカーのものには外から到達できません。リバースプロキシが`publira server`に転送するのは`/rpc`と`/images`だけだからです。

## ログ

`publira server`、`publira worker`、`publiractl`は、ログを標準出力に1行1レコードで、`key=value`の形式で出力します。

```text
time=2026-10-07T09:41:03.402Z level=ERROR msg="outbox event dead" event_id=0199b5f0-1c2e-7c41-9a8e-3f5d2a6b7c80 event_type=contact_message_reply_email idempotency_key=… attempts=10 trace_id=4bf92f3577b34da6a3ce929d0e0e4736 span_id=00f067aa0ba902b7 error="dial tcp: connection refused"
```

どのレコードにも`time`、`level`(`INFO`、`WARN`、`ERROR`のいずれか)、`msg`があります。トレース対象のリクエストやジョブの処理中に出力されたレコードには`trace_id`と`span_id`も付くので、トレースのバックエンドで該当のトレースをたどれます。それ以外の項目は出力元によって異なります。アウトボックスのレコードには対象のエントリー(`event_id`、`event_type`、`attempts`)が、メンテナンスジョブのレコードには実行(`job_kind`、`job_id`、`attempt`)が示され、失敗には`error`が付きます。ログレベルは`INFO`に固定されていて、出力を減らしたり詳しくしたりする変数はありません。

Webアプリと`email-renderer`は、Next.jsやNode.jsの標準のプレーンテキストの出力を使います。失敗は`[web-storefront] getTenantSiteInfo failed`のようにアプリ名で始まる行で出力され、準備状態のチェックの失敗は`health check api failed`と出力されます。

### アラートを設定するログ

まずは`publira server`と`publira worker`の`level=ERROR`のレコードすべてにアラートを設定するとよいでしょう。APIが応答できなかったリクエストは、その原因のエラーとともにこのレベルで出力されます。次のレコードは、どれも何かが失われたか止まっていることを意味するので、個別にアラートを設定する価値があります。

| レコード | プロセス | 意味 |
| --- | --- | --- |
| `outbox event dead` | `publira worker` | メール、プッシュ通知、キャッシュの再検証のいずれかが完全に断念されました。どれなのかは`event_type`でわかります。影響は[断念されたエントリーの確認](./10-scheduled-jobs.md#断念されたエントリーの確認)を参照してください |
| `outbox event retry scheduled`の繰り返し | `publira worker` | エントリーの送信先(SMTPサーバー、`email-renderer`、Webアプリ)で障害が起きています。エントリーはおよそ9分間再試行されたあと、deadになります |
| `episode publish failed after all retries` | `publira worker` | 予約したエピソードが**予約済み**のまま残りました。[予約公開](./10-scheduled-jobs.md#予約公開)で説明しているとおり、テナントの管理者とすべてのオペレーターにも通知されます |
| `auditlog: queue is full; dropping entry`、`auditlog: failed to persist; dropping entry` | `publira server` | テナントまたはプラットフォームの監査ログのエントリーが失われました |
| `readiness check failed` | `publira server`、`publira worker` | 示されたチェックが失敗しました。理由は`error`フィールドでわかります |
| `opentelemetry error` | `publira server`、`publira worker` | メトリクスまたはトレースをエクスポートできませんでした。多くの場合、コレクターに到達できないことが原因です |
| `failed to initialize …` | `publira server`、`publira worker` | プロセスが起動できずに終了しました。オーケストレーターが再起動しますが、原因を取り除くまで同じ行が出続けます |

ワーカーの定期ジョブがログと`river_job`テーブルに失敗をどう記録するかは、[ジョブの失敗の記録先](./10-scheduled-jobs.md#ジョブの失敗の記録先)を参照してください。

## メトリクス

`publira server`と`publira worker`に`PUBLIRA_METRICS_ENABLED=true`を設定すると、OpenTelemetryのメトリクスをエクスポートします。設定しなければ何もエクスポートしません。Webアプリと`email-renderer`はメトリクスをエクスポートしません。

エクスポートの方法は`OTEL_METRICS_EXPORTER`で選びます。

- **`otlp`**(既定値)は、60秒ごとに`OTEL_EXPORTER_OTLP_ENDPOINT`へメトリクスを送ります。トレースと同じコレクターのアドレスです。
- 「**`prometheus`**」は、ポート`9464`の`/metrics`でメトリクスを公開し、Prometheusが収集できるようにします。あわせて`OTEL_EXPORTER_PROMETHEUS_HOST=0.0.0.0`も設定してください。既定値の`localhost`では、コンテナの外から到達できません。Kubernetesの同じPodで動かすなど、`publira server`と`publira worker`がネットワーク名前空間を共有する場合は、それぞれに別の`OTEL_EXPORTER_PROMETHEUS_PORT`を設定してください。

[Docker Compose](../2-deployments/3-docker-compose.md)の構成では、`.env`に`PUBLIRA_METRICS_ENABLED`、`OTEL_METRICS_EXPORTER`、`OTEL_EXPORTER_PROMETHEUS_HOST`を設定し、`docker compose up -d`をもう一度実行します。`.env`の値は`server`に渡されます。その他の変数と記録される項目の一覧は、[メトリクスのリファレンス](https://github.com/publira/publira/blob/main/server/README.md#metrics-opentelemetry)にあります。各プロセスは1つの`service.name`で報告します。`publira server`は`publira-api-server`、`publira worker`は`publira-worker`です。`publira server --with-worker`で動かすプロセスは、すべてを`publira-api-server`で報告します。Composeファイルの`server`はこの形で動いています。

### アウトボックス

ワーカーのメトリクスは、アウトボックスの状況を表します。[アウトボックスの説明](./10-scheduled-jobs.md#アウトボックスメールプッシュ通知キャッシュの再検証)のとおり、メール、プッシュ通知、キャッシュの再検証はすべてアウトボックスを通じて送られます。各メトリクスには、エントリーの種類が`outbox.event_type`として付きます。

| メトリクス | 数えるもの | 見るべき点 |
| --- | --- | --- |
| `publira.outbox.events.dead` | 完全に断念されたエントリー | 1件でも増えたら問題です。アラートを設定してください |
| `publira.outbox.events.retry` | 失敗して、再試行が予定された試行 | 高い頻度が続く場合は、その`outbox.event_type`の送信先で障害が起きています |
| `publira.outbox.events.claimed` | ワーカーが送信のためにエントリーを取り出した回数。再試行や再開でエントリーを取り出すたびにもう一度数えるので、すべてのエントリーが送れていても`done`より速く増えます | — |
| `publira.outbox.events.done` | 送信できたエントリー | — |
| `publira.outbox.events.resumed` | 多数の読者へのプッシュ通知のように、処理の一部を終えたあと、残りを後で続けるために戻されたエントリー | — |
| `publira.outbox.handler.duration` | 1回の試行にかかった時間(秒) | 増えている場合は、SMTPサーバー、`email-renderer`、Webアプリのいずれかが遅くなっています |

これらのカウンターが示すのはワーカーが行った処理で、まだ待っているエントリーではありません。送信を止めたワーカーは何も報告せず、その`/readyz`も異常に気づきません。`/readyz`が確認するのはデータベースログインで、エントリーが処理されているかどうかではないからです。待っているエントリーを確認するには、データベースの[管理用ログイン](../2-deployments/2-installing.md#サービスを用意する)で`psql`から接続し、実行予定時刻を過ぎても送られていないエントリーと、取り出されたまま終わっていないエントリーを数えます。

```sql
SELECT status, count(*), min(updated_at)
FROM outbox_events
WHERE (status = 'pending' AND available_at < now() - interval '5 minutes')
   OR (status = 'processing' AND updated_at < now() - interval '15 minutes')
GROUP BY status;
```

正常なワーカーは、実行予定時刻から数秒以内にエントリーを送り、処理の途中だったエントリーは15分後に待ちの状態へ戻します。そのため、このクエリーが1行でも返したら、ワーカーはエントリーを処理しきれていません。

### 監査ログ

`publira server`は、テナント管理画面とプラットフォーム管理画面の監査ログをキューを通じて書き込むので、リクエストはエントリーの書き込みを待ちません。`publira.auditlog.queue.depth`は書き込みを待っているエントリーの数、`publira.auditlog.entries.dropped`は失われたエントリーの数で、`auditlog.drop_reason`ごとに数えます。エントリーが1件でも失われたとき、そしてキューの長さが増え続けるときにアラートを設定してください。キューが増え続けるのは、データベースへの書き込みが追いついていないということです。監査ログのその他のメトリクスは[リファレンス](https://github.com/publira/publira/blob/main/server/README.md#operational-monitoring-for-the-asynchronous-audit-log)にあります。

## トレース

`email-renderer`以外のすべてのプロセスは、`PUBLIRA_TRACING_ENABLED=true`を設定するとOpenTelemetryのトレースをエクスポートします。`publira server`、`publira worker`、Webアプリで一緒に有効にしてください。そうすると、1つのページのリクエストが、WebアプリからAPIを経て、APIが実行したデータベースのクエリーまで1つのトレースになります。

コレクターの指定には、OpenTelemetry SDKが直接読む変数を使います。

| 変数 | 設定する値 |
| --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | コレクターのアドレス。たとえば`http://otel-collector:4318` |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf`。`publira server`と`publira worker`は`grpc`も使えますが、Webアプリは使えません。すべてのプロセスで使える値は`http/protobuf`です |
| `PUBLIRA_DEPLOYMENT_ENVIRONMENT` | `production`、または環境の名前。すべてのスパンに記録され、後述のサンプリングの割合を決めます |

[Docker Compose](../2-deployments/3-docker-compose.md)の構成では、これらの変数と`PUBLIRA_TRACING_ENABLED`を`.env`に設定し、`docker compose up -d`をもう一度実行します。`.env`の値は、ワーカーも動かしている`server`とWebアプリに渡されます。

各プロセスは、それぞれ専用の`service.name`で報告します。`publira server`が提供する3つのAPIは`publira-api-server`、`publira-admin-api-server`、`publira-platform-api-server`、画像配信は`publira-image-server`です。`publira worker`は`publira-worker`と定期ジョブごとの名前で報告します。`publira server --with-worker`で1つのプロセスにまとめた場合も、これらの名前はすべてそのまま使われます。Webアプリは`publira-web-storefront`、`publira-web-admin`、`publira-web-platform`です。名前の一覧と各スパンに記録される内容は、[サーバーのトレースのリファレンス](https://github.com/publira/publira/blob/main/server/README.md#distributed-tracing-opentelemetry)にあります。`publira server`のヘルスチェックはトレースしないので、数秒ごとのプローブでバックエンドがトレースで埋まることはありません。

### サンプリング

`PUBLIRA_DEPLOYMENT_ENVIRONMENT`を設定していないと、どのプロセスも自分を`development`とみなし、すべてのトレースを記録します。それ以外の値を設定すると、記録するのは10件に1件です。記録するかどうかはトレースが始まるところで一度だけ決まり、リクエストがその先で通るすべてのプロセスがその判断を引き継ぎます。そのため、トレースは丸ごと記録されるか、まったく記録されないかのどちらかです。すべてのプロセスに同じ値を設定してください。

割合を変えるには、SDK標準の`OTEL_TRACES_SAMPLER`と`OTEL_TRACES_SAMPLER_ARG`を設定します。たとえば`parentbased_traceidratio`と`0.25`です。これらを設定したプロセスでは、既定のサンプリングがこの設定に置き換わります。

### リバースプロキシがトレースヘッダーを削除する理由

どのプロセスも、リクエストに付いてきたトレースコンテキストを信頼します。`traceparent`ヘッダーがあれば、プロセスのスパンは呼び出し元のトレースの一部になり、呼び出し元のサンプリングの判断も引き継がれます。WebアプリのスパンとAPIのスパンがつながるのは、この仕組みのおかげです。しかし、ブラウザーやモバイルアプリも同じヘッダーを送れます。そうすると、自分のスパンを他人のトレースに紛れ込ませたり、すべてのリクエストをサンプリング対象にして、10件に1件という割合を超えてリクエストごとにトレースをエクスポートさせたりできてしまいます。

そのため、Publiraの前に置くリバースプロキシは、転送するすべてのリクエストから`traceparent`、`tracestate`、`baggage`を削除します。これは[リバースプロキシの設定のトレースコンテキストの項](../2-deployments/4-edge/index.md#トレースコンテキスト)で、すべてのリバースプロキシに求めている設定です。外部からのリクエストは、すべて新しいトレースとして始まります。一方、WebアプリからAPIへの呼び出しと、APIやワーカーからWebアプリへの呼び出しは、リバースプロキシを通さずプライベートネットワーク上で直接行うので、トレースコンテキストが保たれます。
