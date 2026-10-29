---
title: モニタリング
description: /livezと/readyzによる各プロセスの監視、アラートを出すべきログ行とメトリクス、OpenTelemetryのメトリクスとトレースの有効化。
published: 2026-10-29
source_updated: 2026-10-28
---

インストール環境は、4つの方法で自身の状態を知らせます。どのプロセスも死活チェックと準備状態のチェックに応答し、`publira server`と`publira worker`は構造化ログを書き、同じ2つは有効にすればOpenTelemetryのメトリクスをエクスポートし、`email-renderer`以外のすべてのプロセスはOpenTelemetryのトレースをエクスポートできます。このページでは、それぞれが何を報告するか、それらをオーケストレーターとアラートの仕組みにどうつなぐか、何がアラートに値するかを説明します。それらをどの監視システムで受け取るかはあなたが選びます。このページでは、インストール環境が送るものだけを示します。

変数の詳細は、[`publira server`と`publira worker`のリファレンス](https://github.com/publira/publira/blob/main/server/cmd/publira/README.md)、[サーバーのトレースとメトリクスのリファレンス](https://github.com/publira/publira/blob/main/server/README.md#distributed-tracing-opentelemetry)、[Webアプリのトレースのリファレンス](https://github.com/publira/publira/blob/main/packages/tracing/README.md)にあります。このページでは繰り返さずにそれらへリンクします。

## ヘルスチェック

どのプロセスも、プレーンなHTTPで2つのリクエストに応答します。

- 「**`GET /livez`**」は、プロセスが少しでも応答できる限り、`200`とテキスト`ok`を返します。それ以外は何もチェックしないので、失敗するのはプロセスが固まったか止まったときだけです。
- 「**`GET /readyz`**」は、プロセスが依存するものをチェックし、すべてのチェックが通れば`200`を、どれか1つでも失敗すれば`503`を返します。本文には各チェックの名前が出ます。

| プロセス | ポート | `/readyz`がチェックするもの |
| --- | --- | --- |
| `publira server` | `8000`（`PUBLIRA_PUBLIC_API_ADDR`） | 3つのデータベースログインのそれぞれ：`db.public`、`db.admin`、`db.platform`、または`--role`で与えたロールのログイン。[リードレプリカ](../2-deployments/7-scaling-out.md#レプリカから読み取る)を与えている場合は`db.public.replica`も |
| `publira worker` | `8003`（`PUBLIRA_WORKER_ADDR`） | 3つのデータベースログインのそれぞれ：`db.outbox`、`db.ticker`、`db.content_stats`、または`--queue`で与えたキューのログイン。`maintenance`キューを受け持ち、[リードレプリカ](../2-deployments/7-scaling-out.md#日次の再構築)を与えている場合は`db.content_stats.replica`も。また、ジョブキューが開始するまでは準備ができていないと応答します |
| `web-storefront`、`web-admin`、`web-platform` | `PORT`：リポジトリがビルドするイメージでは`3000`、`4000`、`4100` | `api`：`PUBLIRA_GRPC_URL`が指すホストの`publira server`の`/readyz`。`PUBLIRA_PUBLIC_GRPC_URL`を設定した`web-admin`では`public-api`：そちらが指すホストの同じもの。そして`redis`：`PNCH_REDIS_URL`の共有キャッシュへのping。このキャッシュが無効な間は常に通ります |
| `email-renderer` | `8080`（`PORT`） | なし。ほかのサービスに依存しないので、起動していれば常に準備ができています |

`publira server --with-worker`のプロセスは、表の最初の2行の両方のポートで、それぞれの行が示すチェックとともに応答するので、2つのプロセスを監視するのと同じように監視してください。

どのプロセスも、オブジェクトストア、SMTPサーバー、検索エンジンはチェックしません。そこでの障害は、`/readyz`ではなく、ログと読者が目にするものに現れます。

正常な応答は次のようになります。

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

`status`は、すべてのチェックが通れば`ok`、1つでも失敗すれば`unavailable`、ワーカーのジョブキューがまだ開始していない間は`starting`です。失敗したチェックには`error`が付きますが、これは失敗の種類（`timeout`、`dependency_failed`、`not configured`）だけを示し、ホスト名や接続文字列は決して含まないので、この応答は誰に見せても安全です。理由そのものは、チェックの名前を示す`readiness check failed`の行としてプロセスのログに書かれます。

各チェックには2秒が与えられます。`publira server`と`publira worker`はチェックを1つずつ順番に実行するので、すべてのログインが固まると応答にはおよそ6秒かかります。Webアプリはチェックを並行して実行し、およそ2秒以内に応答します。

### オーケストレーターからの監視

すべてのプロセスのliveness probeは`/livez`に、readiness probeは`/readyz`に向けてください。`/readyz`を決してliveness probeとして使わないでください。データベースが応答しなくなると、オーケストレーターがすべてのプロセスを一斉に再起動することになり、それではデータベースは戻らず、プロセスがキャッシュからまだ提供できていたものまで失われます。

Webアプリの`/readyz`は、`publira server`の`/readyz`が失敗すると必ず失敗するので、データベースログインが1つ応答しなくなると、`publira server`とともにすべてのWebアプリの準備ができていない状態になります。これは意図したものです。正常に動くAPIに到達できないWebアプリは、キャッシュされていないページを提供できないからです。ただしその結果、準備状態に従うロードバランサーは、すべてのWebアプリへのトラフィックの送信を一斉に止めます。ロードバランサーを`/readyz`に向ける前に、それが望む動きかどうかを決めてください。

`publira server`や`publira worker`の`/readyz`のプローブには、6秒より長いタイムアウトを与えてください。そうすれば、遅いチェックはプローブのタイムアウトとしてではなく、そのチェックが示す失敗として報告されます。Kubernetesでは、ワーカーのプローブは次のようになります。すべてのプロセスのプローブは[Kubernetes](../2-deployments/5-kubernetes/index.md#4-プロセスを起動する)にあります。

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

ECSでは、サービスのタスクのヘルスチェックはどれもliveness probeとして働きます。サービスは、ヘルスチェックに失敗したタスクを置き換えるからです。[ヘルスチェック](../2-deployments/6-ecs-fargate/index.md#ヘルスチェック)では、それらをすべて`/livez`に向けています。

[Docker Compose](../2-deployments/3-docker-compose.md)のインストール環境では、Publiraのすべてのプロセスに、その`/readyz`に対するヘルスチェックを設定しています。ヘルスチェックはコンテナの内側から行われ、起動後の最初の1分間は2秒ごとに行われて失敗は数えられず、その後は10秒ごとに行われて3回続けて失敗するとプロセスが`unhealthy`になります。`server`は両方のポートでチェックされます。`docker compose ps`は各サービスの横に結果を表示し、Webアプリは`server`とValkeyが正常になってから、プロキシは`server`、`web-storefront`、`web-admin`が正常になってから起動します。イメージは独自のDockerの`HEALTHCHECK`を宣言していません。どのイメージにも`curl`が入っていないので、Composeファイルはサーバーのイメージでは`bash`を、それ以外のイメージでは`node`を実行します。

これらの結果によってプロセスを再起動するものはありません。Composeが再起動するのは終了したプロセスで、固まったプロセスや異常になったプロセスではありません。結果は、そのプロセスを待つサービスを待たせるためにしか使いません。そうなったときに知らせを受けるには、インストール環境を外側から、コンテナのネットワークに到達できるモニターから監視するか、`docker compose ps`を見てください。テナントのサイトの`/livez`と`/readyz`は、`https://comics.example.com/readyz`のように、各テナントのドメインでリバースプロキシを通じても到達でき、インターネット上の稼働監視で利用できます。APIとワーカーのものには到達できません。プロキシは`/rpc`と`/images`だけを`publira server`に転送するからです。

## ログ

`publira server`、`publira worker`、`publiractl`は、ログを標準出力に、1行に1レコードずつ、`key=value`の組として書きます。

```text
time=2026-10-07T09:41:03.402Z level=ERROR msg="outbox event dead" event_id=0199b5f0-1c2e-7c41-9a8e-3f5d2a6b7c80 event_type=contact_message_reply_email idempotency_key=… attempts=10 trace_id=4bf92f3577b34da6a3ce929d0e0e4736 span_id=00f067aa0ba902b7 error="dial tcp: connection refused"
```

どのレコードにも`time`、`level`（`INFO`、`WARN`、`ERROR`）、`msg`があります。トレースされているリクエストやジョブを処理している間に書かれたレコードには`trace_id`と`span_id`もあり、トレースのバックエンドでそのトレースをたどれます。それ以外の項目は、何がログを書いたかによって異なります。アウトボックスのレコードはエントリーを（`event_id`、`event_type`、`attempts`）、メンテナンスジョブのレコードは実行を（`job_kind`、`job_id`、`attempt`）示し、失敗には`error`が付きます。レベルは`INFO`に固定されており、ログを減らしたり詳しくしたりする変数はありません。

Webアプリと`email-renderer`は、代わりにNext.jsとNode.js自身のプレーンテキストの出力を書きます。失敗は、`[web-storefront] getTenantSiteInfo failed`のように、アプリの名前を先頭に付けた行で、失敗した準備状態のチェックは`health check api failed`としてログに書かれます。

### アラートを出すべきもの

まずは、`publira server`と`publira worker`の`level=ERROR`のすべてのレコードでアラートを出すのが妥当です。APIが応答できなかったリクエストは、その原因となったエラーとともに、このレベルでログに書かれます。次のレコードは、それぞれ何かが失われたか止まっていることを意味するので、個別にアラートを出す価値があります。

| レコード | プロセス | 意味 |
| --- | --- | --- |
| `outbox event dead` | `publira worker` | メール、プッシュ通知、キャッシュの再検証のいずれかが完全に断念された。`event_type`がどれかを示します。[アウトボックス](./10-scheduled-jobs.md#断念されたものを確認する)に何が失われるかがあります |
| `outbox event retry scheduled`の繰り返し | `publira worker` | エントリーの送信先（SMTPサーバー、`email-renderer`、Webアプリ）が失敗している。エントリーは、deadになる前におよそ9分間再試行されます |
| `episode publish failed after all retries` | `publira worker` | 予約したエピソードが**予約済み**のまま残った。[予約公開](./10-scheduled-jobs.md#予約公開)で説明しているとおり、テナントの管理者とすべてのオペレーターにも通知されます |
| `auditlog: queue is full; dropping entry`、`auditlog: failed to persist; dropping entry` | `publira server` | テナントまたはプラットフォームの監査ログのエントリーが失われた |
| `readiness check failed` | `publira server`、`publira worker` | 示されたチェックが失敗した。`error`フィールドが理由を示します |
| `opentelemetry error` | `publira server`、`publira worker` | メトリクスまたはトレースをエクスポートできなかった。たいていはコレクターに到達できないためです |
| `failed to initialize …` | `publira server`、`publira worker` | プロセスが起動できずに終了した。オーケストレーターが再起動しますが、原因が直るまで同じ行が繰り返し出ます |

ワーカーの定期ジョブが、ログと`river_job`テーブルに失敗をどう記録するかは、[ジョブの失敗が記録される場所](./10-scheduled-jobs.md#ジョブの失敗が記録される場所)にあります。

## メトリクス

`publira server`と`publira worker`は、`PUBLIRA_METRICS_ENABLED=true`を設定するとOpenTelemetryのメトリクスをエクスポートします。設定しなければ何もエクスポートしません。Webアプリと`email-renderer`はメトリクスをエクスポートしません。

エクスポートの方法は`OTEL_METRICS_EXPORTER`で選びます。

- **`otlp`**（既定値）は、60秒ごとに、トレースと同じコレクターのアドレスである`OTEL_EXPORTER_OTLP_ENDPOINT`へメトリクスを送ります。
- 「**`prometheus`**」は、Prometheusのスクレイパー向けに、ポート`9464`の`/metrics`でメトリクスを提供します。あわせて`OTEL_EXPORTER_PROMETHEUS_HOST=0.0.0.0`も設定してください。既定値の`localhost`には、コンテナの外から到達できません。Kubernetesの1つのPodのように、`publira server`と`publira worker`がネットワーク名前空間を共有する場合は、それぞれに別の`OTEL_EXPORTER_PROMETHEUS_PORT`を与えてください。

[Docker Compose](../2-deployments/3-docker-compose.md)のインストール環境では、`.env`に`PUBLIRA_METRICS_ENABLED`、`OTEL_METRICS_EXPORTER`、`OTEL_EXPORTER_PROMETHEUS_HOST`を設定し（このファイルがそれらを`server`に渡します）、`docker compose up -d`をもう一度実行してください。その他の変数と、記録されるものの一覧は、[メトリクスのリファレンス](https://github.com/publira/publira/blob/main/server/README.md#metrics-opentelemetry)にあります。各プロセスは1つの`service.name`で報告します。`publira server`は`publira-api-server`、`publira worker`は`publira-worker`です。`publira server --with-worker`のプロセス（Composeファイルの`server`がこれです）は、すべてを`publira-api-server`で報告します。

### アウトボックス

ワーカーのメトリクスは、アウトボックスを追跡します。[アウトボックス](./10-scheduled-jobs.md#アウトボックスメールプッシュ通知キャッシュの再検証)で説明しているとおり、すべてのメール、プッシュ通知、キャッシュの再検証はアウトボックスを通じて送られます。各メトリクスには、エントリーの種類が`outbox.event_type`として付きます。

| メトリクス | 数えるもの | 注視すべきこと |
| --- | --- | --- |
| `publira.outbox.events.dead` | 完全に断念されたエントリー | どんな増加も。これでアラートを出してください |
| `publira.outbox.events.retry` | 再試行される失敗した試行 | 高いまま続く頻度。その`outbox.event_type`の送信先が失敗しています |
| `publira.outbox.events.claimed` | ワーカーが送信のためにエントリーを取り上げた回数。再試行されたエントリーや再開されたエントリーは再び取り上げられ、再び数えられるので、すべてのエントリーが送られていても、これは`done`より速く増えます | — |
| `publira.outbox.events.done` | 送られたエントリー | — |
| `publira.outbox.events.resumed` | 処理の一部を送ったあと、あとで続けるために戻されたエントリー（多くの読者へのプッシュ通知など） | — |
| `publira.outbox.handler.duration` | 1回の試行にかかった時間（秒） | 増加。SMTPサーバー、`email-renderer`、またはWebアプリが遅くなっています |

カウンターが示すのはワーカーが行ったことで、まだ待っているものではありません。送信を止めたワーカーは何も報告せず、その`/readyz`も気づきません。こちらはデータベースログインをチェックするもので、エントリーが動いているかどうかはチェックしないからです。待っているものを確認するには、データベースの[管理用ログイン](../2-deployments/2-installing.md#サービスを用意する)で接続した`psql`で、実行時刻を過ぎても送られていないエントリーと、取り上げられたまま終わっていないエントリーを数えてください。

```sql
SELECT status, count(*), min(updated_at)
FROM outbox_events
WHERE (status = 'pending' AND available_at < now() - interval '5 minutes')
   OR (status = 'processing' AND updated_at < now() - interval '15 minutes')
GROUP BY status;
```

正常なワーカーは、エントリーの実行時刻から数秒以内にそれを送り、処理の途中だったエントリーは15分後に待ちの状態へ戻します。そのため、このクエリーが1行でも返せば、ワーカーは滞りなく処理できていません。

### 監査ログ

`publira server`は、テナント管理画面とプラットフォーム管理画面の監査ログをキューを通じて書くので、リクエストはエントリーの書き込みを待ちません。`publira.auditlog.queue.depth`は待っているエントリーの数で、`publira.auditlog.entries.dropped`は失われたエントリーを`auditlog.drop_reason`ごとに数えます。どんな欠落にも、増え続けるキューの深さにもアラートを出してください。後者はデータベースが追いついていないことを意味します。監査ログのその他のメトリクスは、その[リファレンス](https://github.com/publira/publira/blob/main/server/README.md#operational-monitoring-for-the-asynchronous-audit-log)にあります。

## トレース

`email-renderer`以外のすべてのプロセスは、`PUBLIRA_TRACING_ENABLED=true`を設定するとOpenTelemetryのトレースをエクスポートします。`publira server`、`publira worker`、Webアプリでまとめて有効にしてください。そうすれば、ページのリクエストが、Webアプリから、APIを通って、それが行ったデータベースのクエリーまで、1つのトレースになります。

OpenTelemetry SDKが自ら読む変数で、コレクターを指定してください。

| 変数 | 設定する値 |
| --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | コレクター。たとえば`http://otel-collector:4318` |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf`。`publira server`と`publira worker`は`grpc`も受け付けますが、Webアプリは受け付けないので、すべてのプロセスで使える値は`http/protobuf`です |
| `PUBLIRA_DEPLOYMENT_ENVIRONMENT` | `production`、または環境の名前。すべてのスパンに記録され、後述のサンプリングを決めます |

[Docker Compose](../2-deployments/3-docker-compose.md)のインストール環境では、これらと`PUBLIRA_TRACING_ENABLED`を`.env`に設定し（このファイルがそれらを、ワーカーも動かす`server`と、Webアプリに渡します）、`docker compose up -d`をもう一度実行してください。

各プロセスは、それぞれ独自の`service.name`で報告します。`publira server`が提供する3つのAPIには`publira-api-server`、`publira-admin-api-server`、`publira-platform-api-server`、その画像配信には`publira-image-server`、`publira worker`には`publira-worker`と定期ジョブごとの名前が使われ、`publira server --with-worker`が両方を1つのプロセスで動かす場合もそれらはすべてそのまま使われます。Webアプリには`publira-web-storefront`、`publira-web-admin`、`publira-web-platform`が使われます。一覧と、各スパンに記録されるものは、[サーバーのトレースのリファレンス](https://github.com/publira/publira/blob/main/server/README.md#distributed-tracing-opentelemetry)にあります。`publira server`のヘルスチェックはトレースされないので、プローブのたびに数秒おきのトレースでバックエンドが埋まることはありません。

### サンプリング

`PUBLIRA_DEPLOYMENT_ENVIRONMENT`が設定されていない場合、どのプロセスも自身を`development`とみなし、すべてのトレースを記録します。それ以外の値では、10件に1件のトレースを記録します。この判断はトレースが始まる場所で一度だけ行われ、リクエストがその先で到達するすべてのプロセスがそれを引き継ぐので、トレースは丸ごと記録されるか、まったく記録されないかのどちらかです。すべてのプロセスに同じ値を設定してください。

別の割合でサンプリングするには、SDK自身の`OTEL_TRACES_SAMPLER`と`OTEL_TRACES_SAMPLER_ARG`を設定してください。たとえば`parentbased_traceidratio`と`0.25`です。これらは、設定したすべてのプロセスで既定の動作を置き換えます。

### エッジがトレースヘッダーを取り除く理由

どのプロセスも、リクエストに付いてきたトレースコンテキストを信頼します。`traceparent`ヘッダーは、そのスパンを呼び出し元のトレースの一部にし、呼び出し元のサンプリングの判断を伝えます。これによって、WebアプリのスパンがAPIのスパンとつながります。しかし、ブラウザーやモバイルアプリも同じヘッダーを送ることができ、それによって自分のスパンを他人のトレースに付け加えたり、すべてのリクエストをサンプリング対象としてマークし、10件に1件という割合を超えてリクエストごとにトレースをエクスポートさせたりできます。

そのため、インストール環境の前に置くエッジは、[トレースコンテキスト](../2-deployments/4-edge/index.md#トレースコンテキスト)がすべてのエッジに求めているとおり、転送するすべてのリクエストから`traceparent`、`tracestate`、`baggage`を取り除き、外部からのすべてのリクエストは新しいトレースを始めます。WebアプリはAPIを、APIとワーカーはWebアプリを、エッジを通さずプライベートネットワーク上で直接呼び出すので、それらのトレースコンテキストは保たれます。
