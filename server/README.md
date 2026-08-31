# server

Go バックエンドです。単一モジュール `github.com/publira/publira/server` で運用します。

## ディレクトリ構成

```text
server/
├── cmd/
│   ├── api-server/        # 公開向け ConnectRPC API サーバー
│   ├── admin-api-server/  # 管理向け ConnectRPC API サーバー
│   ├── platform-api-server/ # プラットフォーム管理向け ConnectRPC API サーバー
│   ├── image-server/      # 公開向け画像配送（Manael 変換）
│   ├── admin-image-server/ # 管理向け画像配送
│   ├── batch/             # 全バッチジョブを束ねた単一バイナリ（サブコマンドで選択）
│   └── outbox-worker/     # Outbox + River 常駐ワーカー
├── bin/                   # task build で生成されるバイナリ
├── gen/                   # buf 自動生成コード (編集禁止)
└── internal/
    ├── db/                # sqlc 自動生成コード (編集禁止)
    └── testutil/          # Testcontainers 等のテスト共通ヘルパー
```

## 担当機能

- マルチテナント運用の API 提供
- コンテンツ入稿/公開に関する業務ロジック
- 日次コンテンツ統計の完全再集計
- 閲覧イベントの保持期限パージ
- 予約公開バッチ (公開状態への遷移)
- 認証・セキュリティ基盤

## 実装ルール

1. スキーマ駆動開発: API/DB の変更は `proto/` または `db/migrations/` の golang-migrate 形式 (`.up.sql` / `.down.sql`) を先に変更し、`task gen` を実行する
2. `cmd/` は薄く保ち、実装は `internal/` に寄せる
3. バッチはすべて `cmd/batch` の単一バイナリで、第 1 引数のサブコマンドが実行するジョブを選ぶ。`batch publish-episodes` は予約公開のティック処理。Outbox ワーカー (`cmd/outbox-worker`) は API から分離した常駐プロセスで、River がジョブを実行する

## 開発コマンド

```bash
task db:setup
task db:seed
task db:create NAME=add_example_column
task server:dev-api
task server:dev-admin-api
task server:dev-platform-api
task server:dev-outbox-worker
task server:tidy
task server:build
task server:lint
task server:test
```

## Lint

- `task server:lint`（= `golangci-lint run ./...`）で静的解析を実行します。CI の `Lint / Go` ジョブと同じ設定・同じバージョンです。
- ルールセットは [`.golangci.yml`](.golangci.yml)。golangci-lint 既定の `standard` セット（`errcheck` / `govet` / `ineffassign` / `staticcheck` / `unused`）を有効にしています。
- `golangci-lint` は devcontainer にバージョン固定で入っています（[`.devcontainer/Dockerfile`](../.devcontainer/Dockerfile) の `GOLANGCI_LINT_VERSION`）。devcontainer 外で実行する場合は同じバージョンを入れてください。
- 生成コード（`gen/**`、`internal/db/*.sql.go` など）は `DO NOT EDIT.` ヘッダで自動的に除外されます。`internal/db/` の手書き統合テストは対象のままです。

## テスト

- 単体テストは主に `sqlmock` で DB をモックします。
- 実 DB の統合テストは [Testcontainers for Go](https://golang.testcontainers.org/) で PostgreSQL コンテナを起動します。
  - 共通ヘルパー: `internal/testutil`（マイグレーション適用・アプリロール seed・Snapshot/Restore・テナント/カタログ seed）
  - アプリロール別の接続を `OpenPlatformDB` / `OpenAdminDB` / `OpenPublicDB` で開きます。後者 2 つは RLS が有効なので、テナント境界そのものを検証できます。
  - 例: `api/platformapi` の `TestDB*`（テナント作成・重複制約・状態遷移など）、`api/adminapi` の `TestDB*`（テナント分離）、`api/publicapi` の `TestDB*`（公開/非公開フィルタ・会員認証）
- 実行要件: ローカルに Docker が使えること（未起動時は当該テストを skip）
- 高速化: `go test -short ./...` でコンテナ起動を伴う統合テストをスキップできます

## エントリポイント詳細

- 公開 API サーバー: [cmd/api-server/README.md](cmd/api-server/README.md)
- 管理 API サーバー: [cmd/admin-api-server/README.md](cmd/admin-api-server/README.md)
- プラットフォーム API サーバー: [cmd/platform-api-server/README.md](cmd/platform-api-server/README.md)
- 公開画像サーバー: [cmd/image-server/README.md](cmd/image-server/README.md)
- 管理画像サーバー: [cmd/admin-image-server/README.md](cmd/admin-image-server/README.md)
- バッチ（予約公開 / 日次コンテンツ統計 / 閲覧イベントパージ / Recommend feature build）: [cmd/batch/README.md](cmd/batch/README.md)
- Outbox ワーカー: [cmd/outbox-worker/README.md](cmd/outbox-worker/README.md)

## Graceful shutdown

常駐プロセス（`api-server` / `admin-api-server` / `platform-api-server` / `image-server` / `admin-image-server` / `outbox-worker`）は SIGINT / SIGTERM で `http.Server.Shutdown` を呼びます。`outbox-worker` は同じ期限で River クライアントも停止します。処理中リクエストの排出と、登録済みのシャットダウンフックは同じ 30 秒の期限を共有します。猶予を超えた接続は `Close` で切断します。`admin-api-server` と `platform-api-server` は HTTP の排出後かつ DB プールを閉じる前に、残った非同期監査ログを同じ残り時間で flush します。期限を超えると、進行中の保存をキャンセルして未保存イベントを drop し、件数と原因をメトリクス・構造化ログへ残します。各 `main` は DB プールのクローズを最後のフックとして渡し、起動失敗経路の安全網として `defer db.Close()` も残しています。OpenTelemetry の span flush は [#196](https://github.com/publira/publira/issues/196) がフックを追加したあとにこの経路へ乗ります。

オーケストレータの SIGKILL 猶予は 30 秒より長くしてください（Kubernetes なら `terminationGracePeriodSeconds` を 45 以上）。ロードバランサの readiness 排出は別途の設定です。

## Stripe Checkout（エピソード購入）

有料エピソードは Stripe Checkout の一回払いで販売します。ブラウザが戻る URL は購入を確定しません。`web-host` の `POST /api/v1/webhook/stripe` はテナントの公開ドメインで受け、Stripe の生 body と署名を PurchaseService へ転送するだけです。API サーバーが対象テナントの有効な決済設定で署名を検証し、`checkout.session.completed`（非同期決済は `checkout.session.async_payment_succeeded`）を受信したときだけ `purchases` を作成します。

Checkout 開始と Webhook 検証は `tenant_payment_config` の有効設定を使います。設定が無い・無効・復号できないときは決済を開始せず、Webhook も購入を反映しません（web-host は `FailedPrecondition` を 503 にします）。購入完了・取消後の戻り先はテナントの `domain` 上のエピソード URL です。

テナント管理者は `AdminPaymentSettingsService` で Stripe secret key と Webhook signing secret を登録します。公開読み出しは有効状態とマスク済み hint だけを返し、平文は `paymentsettings.Store.LoadEnabledSecrets` 経由のサーバー内部利用に限ります。署名・通貨・金額・購入権限の検証は API サーバーに残します。

Stripe Dashboard ではテナントの公開ドメイン `https://<tenant-domain>/api/v1/webhook/stripe` を Webhook endpoint として登録し、上記 2 イベントを有効化してください。ローカル開発では次のように Stripe CLI で転送します。

```bash
stripe listen --forward-to localhost:3000/api/v1/webhook/stripe
```

表示された `whsec_...` を、そのテナントの Webhook signing secret として `UpdateTenantPaymentSettings` に保存します。テストカードは Stripe の `4242 4242 4242 4242`、任意の将来日、有効な CVC を使えます。Webhook は再送されても `stripe_checkout_session_id` の一意制約により購入を重複作成しません。すでに有効な購入があるエピソードは Checkout を開始せず、期限切れ後は再購入できます。

## 画像ストレージ設定

`UploadEpisodeImages` は S3 互換ストレージにアップロードします。`PUBLIRA_S3_BUCKET` が未設定なら、サーバーは起動時に失敗します。

- `PUBLIRA_S3_BUCKET` (必須)
- `AWS_REGION` (推奨)
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` (必要に応じて)
- `PUBLIRA_S3_ENDPOINT` (任意, RustFS / MinIO 等)
- `PUBLIRA_S3_FORCE_PATH_STYLE` (任意, `true`/`false`)
- `PUBLIRA_S3_PUBLIC_BASE_URL` (任意)

### バケットの初期化

バケット作成はアプリの責務ではありません（通常リクエストで作成しません）。開発環境では次のタスクが冪等に用意します。

```bash
task storage:init
```

aws CLI で `PUBLIRA_S3_BUCKET` を作成します（既存ならそのまま成功）。`task dev` では各サーバーの起動前に、`task setup` では `db:setup` の後に実行され、E2E / bootstrap の準備でも実行されます。本番バケットは対象外で、IAM やライフサイクルと合わせて別途プロビジョニングします。

### 開発環境 (RustFS)

Dev Container では S3 互換の RustFS が起動し、path-style で接続します（エンドポイント `http://rustfs:9000`、バケット `publira`、資格情報はローカル専用の `publira` / `publirapass`）。値の一覧とコンソール URL は [../README.md](../README.md#object-storage-for-development-rustfs) を参照してください。

RustFS に対する Go の統合テストは `internal/testutil` の Testcontainers ヘルパー (`StartRustFS`) を使い、`internal/storage/s3` のアップロードと `internal/imageserver` の取得を検証します（`-short` や Docker 不在ではスキップ）。

## 画像配送（Manael）

`image-server` / `admin-image-server` は権限確認のあと [Manael](https://github.com/manaelproxy/manael) で JPEG/PNG/GIF を WebP または AVIF に変換し、`w` / `h` / `fit` / `q` で縮小します。変換結果は中間キャッシュに置き、同じ `Accept` とクエリなら S3 と変換を再実行しません。

購入・チケットで解放されたエピソード本文は、`PUBLIRA_IMAGE_ENCRYPTION=enabled` のとき、キャッシュ済みの変換済み平文をそのまま返さず、応答直前に短命 JWT と `sub` に結び付けて暗号化します。既定は無効です。#357 の復号実装を配備してから明示的に有効化することで、先行デプロイで既存ビューアを壊しません。暗号化時のレスポンスは `Content-Type: application/octet-stream` で、次のヘッダが復号契約です。公開画像と、`<img>` を使う管理プレビューは従来どおりの画像レスポンスです。

| Header | Value / meaning |
| --- | --- |
| `X-Publira-Image-Encryption` | `xor-hmac-sha256-v1` |
| `X-Publira-Image-Content-Type` | 復号後の MIME type (`image/webp` / `image/avif` 等) |
| `X-Publira-Image-Key-Id` | 変換済み rendition の不透明な識別子 |

`xor-hmac-sha256-v1` は、JWT 文字列を HMAC キーとして `"publira:image:xor-hmac-sha256:v1\\0" + sub + "\\0" + key-id` を HMAC-SHA-256 し、その出力を HMAC キーにします。8 byte big-endian のブロック番号を HMAC-SHA-256 した 32 byte ストリームを本文へ XOR します。これは抽出耐性を上げる配信層であり DRM ではありません。クライアントは URL の `t`（または送信した Bearer JWT）、JWT の `sub`、上記ヘッダで同じ処理を行います。詳細な fetch・復号・Canvas 描画は #357 が担当します。

- `PUBLIRA_REDIS_URL`: 変換キャッシュの Redis。未設定 / `disabled` / `off` / `false` のときはプロセス内メモリのみ
- `PUBLIRA_IMAGE_CACHE_TTL`: 変換キャッシュの TTL（Go duration または秒。既定 `1h`）
- `PUBLIRA_IMAGE_ENCRYPTION`: `enabled` / `true` / `on` / `1` のとき、認可済みエピソード本文を `xor-hmac-sha256-v1` で暗号化（既定は無効）

### 負荷・キャッシュ確認

レスポンスの `X-Publira-Image-Cache: miss|hit` を、同一画像・同一 `Accept`・同一変換パラメータで確認します。最初の `miss` だけが S3 読み出しと Manael 変換を行い、以後の `hit` は Redis（設定時）またはプロセス内キャッシュの平文 rendition に対する暗号化だけを行います。暗号化を有効にした検証では、異なる JWT で本文が異なるバイト列になること、各レスポンスを復号すると同じ rendition になること、`hit` 中にオリジン読み出しが増えないことを合わせて測定してください。

ビルドには libvips が必要です。詳細は [cmd/image-server/README.md](cmd/image-server/README.md)。

## Platform Console URL

- `PUBLIRA_PLATFORM_APP_URL`
  - platform-auth のパスワード再設定メールに含める Platform Console のベース URL
  - 例: `https://platform.example.com`
  - 未設定時はローカル開発向けに `http://platform.localhost:3080` を使用

## Next.js 再検証の内部 URL

`PUBLIRA_REVALIDATE_TOKEN` を設定すると、admin-api と `batch publish-episodes` は各 Next.js アプリの内部 Route Handler `POST /api/v1/revalidate` へキャッシュタグを送ります。テナント ID は URL・リクエスト本文・送信時の許可判定には含めず、タグはテナントをまたいでもそのまま再検証されます。3 つの URL はすべて必須です。いずれかが未設定または不正な場合、再検証は無効になり、プロセスは理由をログへ出して通常どおり起動します。

- `PUBLIRA_WEB_HOST_INTERNAL_URL`（例: `http://web-host:3000`）
- `PUBLIRA_WEB_ADMIN_INTERNAL_URL`（例: `http://web-admin:4000`）
- `PUBLIRA_WEB_PLATFORM_INTERNAL_URL`（例: `http://web-platform:4100`）

これらは private network 内で到達する URL です。ブラウザ用の公開 URL や `PUBLIRA_WEB_HOST_URL`、Traefik を経由させません。各アプリは `PUBLIRA_CACHE_APP` ごとに Redis のキー空間を分けるため、同じタグを 3 アプリすべてへ送る必要があります。

## Email renderer

- `PUBLIRA_EMAIL_RENDERER_URL`
  - outbox-worker がテナント管理者招待メールを HTML / プレーンテキストへ描画する ConnectRPC サービスの URL
  - 例: `http://email-renderer:8080`（コンテナ間通信）
  - 未設定時はローカル開発向けに `http://localhost:8080` を使用する

## 分散トレーシング (OpenTelemetry)

`cmd/*` の全プロセスが OpenTelemetry でトレースを出します。**既定は無効**で、`PUBLIRA_TRACING_ENABLED` を立てない限り TracerProvider も propagator も差し替えず、計装導入前とまったく同じ挙動になります（収集基盤が無くても起動します）。

属性名・span 命名・サンプリング方針は [#502](https://github.com/publira/publira/issues/502) の設計合意に従います。

### 何に span が付くか

| 層 | 計装 | span |
| --- | --- | --- |
| Connect / gRPC の inbound | `connectrpc.com/otelconnect` | RPC ごとに 1 本。名前は `AdminSeriesService/ListSeries`（proto パッケージは `rpc.service` 属性が持つので名前からは落とす） |
| 素の HTTP の inbound（image-server / admin-image-server） | `otelhttp` | ルートパターンごとに 1 本（`GET /images/creators/{media_id}`）。`/livez` `/readyz` は除外 |
| DB クエリ | `XSAM/otelsql`（`internal/sqldb` で pgx ドライバをラップ） | 文ごとに `db.query` 1 本 |
| 予約公開バッチ | `internal/publishepisodes` | `RunOnce` 1 サイクルにつき 1 本の親 span |
| Outbox ワーカー | `internal/outbox` | drain 1 回とイベント処理 1 件につき各 1 本（`outbox.drain` / `outbox.process`） |
| outbound HTTP（Next.js 再検証 / email-renderer） | `otelhttp` の Transport | client span と `traceparent` の伝播 |

伝播は W3C Trace Context（`traceparent`）と Baggage です。inbound の `traceparent` は**親として信頼**するため、web アプリから API、その先の DB クエリまでが 1 トレースに繋がります。信頼してよいのは gateway が外来のヘッダを落としているからで、その境界は次節のとおりです。

### 外部から届く trace context

`traceparent` を親として信頼するサーバーは、そのヘッダを設定できる相手にトレース ID と `sampled` フラグを預けることになります。だから**信頼境界は gateway に置き**、公開エントリポイントを通ったリクエストからは `traceparent` / `tracestate` / `baggage` を除去します。除去はエントリポイントの既定ミドルウェアとして掛けるので、ルーターを増やしても付け忘れが起きません。

| 環境 | どこで落とすか |
| --- | --- |
| 開発 | `.devcontainer/compose.yaml` の Traefik。`web` エントリポイントに `strip-trace-context` ミドルウェア（`headers.customRequestHeaders` の空値）を既定で付ける |
| 本番 | gateway の外部エントリポイントで同じ 3 ヘッダを除去してから backend へ渡す |

ヘッダを落とした結果、API 側ではその RPC が**新しい root span** になります。呼び出し元が指定した trace ID は採用されず、`sampled=01` を付けられても production の 10% サンプリングは上書きされません。トレースが 1 本に繋がるのは gateway より内側だけです。

第一者のサーバー間通信は gateway を通らないので、この除去の影響を受けません。SSR（web-host / web-admin / web-platform）は API の gRPC ポートへ直接繋ぎ、Go の API から Next.js の再検証エンドポイントへは `PUBLIRA_WEB_*_INTERNAL_URL` で直接呼びます。どちらも `traceparent` がそのまま通るため、「web アプリ → API → DB クエリ」は 1 本のトレースのままです。

モバイルアプリとブラウザは利用者の端末で動くので第一者ではなく、gateway で trace context を落とす対象です。

開発環境 Traefik の除去は、[`../e2e/routing/README.md`](../e2e/routing/README.md) の疎通チェックが実際にヘッダを付けたリクエストで検証します。

### 非同期監査ログの運用監視

`admin-api-server` と `platform-api-server` の非同期監査ログは、OpenTelemetry の次の低カーディナリティメトリクスを記録します。`auditlog.entry_type` は `platform` または `tenant`、`auditlog.drop_reason` は `queue_full`、`retry_exhausted`、`shutdown` のいずれかです。`action` やテナント ID はメトリクス属性に含めません。

| メトリクス | 種別 | 意味 |
| --- | --- | --- |
| `publira.auditlog.queue.depth` | gauge | キューで保存待ちのイベント数 |
| `publira.auditlog.entries.enqueued` | counter | キューに受理したイベント数 |
| `publira.auditlog.entries.persisted` | counter | 非同期保存に成功したイベント数 |
| `publira.auditlog.persist.failures` | counter | 保存に失敗した試行数（retry を含む） |
| `publira.auditlog.entries.dropped` | counter | 保存前に drop したイベント数 |

保存失敗の retry、最終 drop、キューあふれ、shutdown drain の期限切れは構造化ログにも出力します。`queue.depth` の継続的な増加、`persist.failures`、`entries.dropped` はアラート候補です。メーターは OTel MeterProvider が設定されたときに export されます。ローカル Collector の設定は [#198](https://github.com/publira/publira/issues/198) の対象です。

### resource 属性

| キー | 値 |
| --- | --- |
| `service.name` | プロセスごとの既定値（`publira-api-server` / `publira-admin-api-server` / `publira-platform-api-server` / `publira-image-server` / `publira-admin-image-server` / `publira-outbox-worker`）。`cmd/batch` はサブコマンドごとに解決するため `publira-publish-episodes` / `publira-aggregate-content-stats` / `publira-purge-content-events` / `publira-build-recommend-features` になる。`OTEL_SERVICE_NAME` で上書き可能 |
| `service.version` | ビルド時に埋め込んだ version。無ければチェックアウトの VCS リビジョン、それも無ければ `dev`（`internal/buildinfo`） |
| `deployment.environment.name` | `PUBLIRA_DEPLOYMENT_ENVIRONMENT`。未設定なら `development` |

コンテナイメージは `.git` を含まないビルドコンテキストで作るため Go が VCS 情報を埋められません。`task docker:build:api VERSION=v1.2.3` のように `VERSION` を渡すと ldflags で `internal/buildinfo` に埋め込まれます。渡さなければ `dev` です。

### span 属性

`otelconnect` / `otelhttp` / `otelsql` が付ける標準属性（`rpc.system` / `rpc.service` / `rpc.method`、`http.request.method` / `http.route`、`db.system.name`）に加えて、次を付けます。

| キー | いつ |
| --- | --- |
| `tenant.public_id` | テナントを解決したあと（Connect のテナントスコープ interceptor と image-server のホスト解決） |
| `enduser.id` | 認証が通ったあと。値は public ID |
| `db.operation.name` | SQL のキーワード（`SELECT` / `INSERT` / …） |
| `db.query.summary` | sqlc の `-- name: GetTenantByID :one` から取ったクエリ名 |
| `db.query.text` | 生成された SQL 文。sqlc はプレースホルダ（`$1`）のまま出力し、引数値は決して記録しません |

メール、生トークン、パスワード、リクエストボディ、`Authorization` ヘッダは span に載せません。内部 UUID ではなく public ID を使うのもこの方針の一部です。

### サンプリング

親準拠（parent-based）で、root span の扱いだけがデプロイ環境で変わります。

| `PUBLIRA_DEPLOYMENT_ENVIRONMENT`          | root span |
| ----------------------------------------- | --------- |
| `development`（既定）                     | 全件      |
| それ以外（`staging` / `production` など） | 10%       |

`OTEL_TRACES_SAMPLER` を設定するとこの既定は使わず、SDK がその値を解釈します。`db.query.text` のような重い属性は sampled な span にしか載らないので、本番で SQL 全文が付くのはサンプルされた 10% だけです。

### ログとの相関

`internal/logging` の slog ハンドラが、span を持つ `context.Context` 付きで記録されたログ（`ErrorContext` などの `*Context` メソッド）に `trace_id` / `span_id` を足します。DB エラーの共通経路である各 API の `internalDBError` はこの経路を通るので、ログの `trace_id` をそのまま Jaeger などで検索できます。

### 環境変数

自前の変数は有効化フラグとデプロイ環境の 2 つだけで、あとは OpenTelemetry SDK 自身が読むため名前を変えていません。

| 変数 | 用途 |
| --- | --- |
| `PUBLIRA_TRACING_ENABLED` | トレースの有効化（`true` / `1` など）。未設定・解釈できない値は無効 |
| `PUBLIRA_DEPLOYMENT_ENVIRONMENT` | `development`（既定） / `staging` / `production`。`deployment.environment.name` と既定サンプリング率を決める |
| `OTEL_TRACES_EXPORTER` | `otlp`（既定） / `console` / `none` |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf` / `grpc` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | 送信先（例: `http://jaeger:4318`） |
| `OTEL_SERVICE_NAME` | `service.name` の上書き |
| `OTEL_RESOURCE_ATTRIBUTES` | 追加の resource 属性 |
| `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG` | サンプラ。設定すると上記の既定を使わない |

収集基盤を用意せずに動きを見たいときは `OTEL_TRACES_EXPORTER=console` にすると標準出力へ span が出ます。

```bash
PUBLIRA_TRACING_ENABLED=true OTEL_TRACES_EXPORTER=console task server:dev-admin-api
```

Dev Container には Jaeger が同梱されています（UI は `http://localhost:16686`）。詳細は [../README.md](../README.md#distributed-tracing-jaeger) を参照してください。

## 機密情報の暗号化設定 (AES-GCM)

機密情報を保存時に AES-GCM で暗号化するための基盤を用意しています。現時点では機密項目の保存経路に適用したときに、以下の環境変数を設定してください。

- `PUBLIRA_SECRET_ENCRYPTION_KEYS`
  - 形式: `key-id-1:base64key,key-id-2:base64key`
  - `base64key` は 16/24/32 byte の AES 鍵を Base64 (標準 or URL-safe) でエンコードした値
- `PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID`
  - `PUBLIRA_SECRET_ENCRYPTION_KEYS` に含まれる key-id を指定
  - 新規暗号化時はこの key-id を使用

鍵ローテーション方針:

1. 新鍵を `PUBLIRA_SECRET_ENCRYPTION_KEYS` に追加する
2. `PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID` を新鍵 ID に切り替える
3. 既存データを再保存/再暗号化して旧鍵暗号文を徐々に置換する
4. 旧鍵で復号されるデータがなくなったことを確認してから旧鍵を削除する

注意:

- 鍵や平文をログへ出力しない
- 暗号化/復号に失敗した場合は処理を継続せず失敗として扱う

## 認証 (JWT アクセストークン)

API は email + password で **HS256 JWT アクセストークン** を発行します（`Login` / `Logout`）。  
ブラウザ向け Cookie は Next.js 側が `jose` で JWE 管理し、API へは `Authorization: Bearer <token>` のみを送ります。

| 項目 | 値 |
| --- | --- |
| 環境変数 | `PUBLIRA_AUTH_JWT_SECRET`（**必須**。32 バイト以上。フォールバックは無く、未設定・短すぎる場合は API サーバーと画像サーバーが起動に失敗） |
| TTL | 24h |
| Audience | `public` / `admin` / `platform` / `media` / `admin-media` |
| 失効 | `users.credentials_version` / `platform_users.credentials_version`（パスワード変更等で +1） |
| Next Cookie | `PUBLIRA_AUTH_SECRET`（**必須**。32 バイト以上。JWE 用で API の JWT secret とは別。フォールバックは無く、未設定・短すぎる場合は例外） / Cookie 名: `publira_web_host_auth` 等 |

### メディアトークン (audience `media`)

ブラウザの `<img>` リクエストには `Authorization` ヘッダーを付けられません。そのため有料エピソードを閲覧できる読者に対しては、`GetEpisodeDetail` が本文画像の URL にクエリ `t=<JWT>` を付けて返します。

| 項目 | 値 |
| --- | --- |
| Audience | `media`（`public` とは別。API へは通らず、アクセストークンを URL に貼っても画像は開かない） |
| TTL | 15 分 |
| スコープ | 発行元のエピソード 1 話分のみ（claim `eid`） |
| 失効 | アクセストークンと同じ `users.credentials_version` |

トークンは読者を名乗るだけで、閲覧可否そのものは `image-server` が purchases / access_tickets を都度参照して判定します（API と同じ規則）。無料エピソード（`price = 0`）の URL にトークンは付きません。

### 管理メディアトークン (audience `admin-media`)

管理画面のエピソード画像プレビューもブラウザの `<img>` / `next/image` 経由なので、`Authorization` は付きません。`ListEpisodeImages` / `UploadEpisodeImages` / `ReorderEpisodeImages` は本文画像 URL にクエリ `t=<JWT>` を付けて返します。

| 項目 | 値 |
| --- | --- |
| Audience | `admin-media`（`media` とも `admin` とも別。公開 image-server と管理 API へは通らない） |
| TTL | 15 分 |
| スコープ | 発行元のエピソード 1 話分のみ（claim `eid`） |
| 失効 | アクセストークンと同じ `users.credentials_version` |

トークンは管理者を名乗るだけで、`admin-image-server` がテナント所属と管理ロール（`tenant_admin` / `tenant_editor` / `tenant_auditor`）を都度参照して判定します。公開状態と価格は見ません。

## 閲覧イベント（soft PV）と匿名 actor

`GetEpisodeDetail` / `GetSeriesDetail` が成功したとき、`content_events` に閲覧イベントを記録します。Phase 1 の soft PV であり、「詳細 RPC が成功した」ことだけを表します（本文を実際に読んだかどうかを見る hard PV は後続）。記録は本処理から切り離されていて、失敗しても RPC は成功します。

| 項目 | 値 |
| --- | --- |
| イベント種別 | `episode_view`（エピソード詳細） / `series_view`（シリーズ詳細） |
| actor | ログイン中は `user_id`、それ以外は `publira_aid` Cookie の `anonymous_id`（`content_events.actor_key` が `COALESCE` で 1 本化する） |
| デバウンス | 固定 epoch 30 分バケツ（`floor(unix / 1800)`）+ 部分 UNIQUE インデックスへの `ON CONFLICT DO NOTHING`。スライディング窓ではない |
| `series_id` | クライアント入力ではなく `episodes` から解決する |
| prefetch | `Sec-Purpose` / `Purpose` / `X-Purpose` / `X-Moz` / `Next-Router-Prefetch` が投機的リクエストを示す場合は記録しない |
| payload | `{"pv_kind":"soft"}` のみ。IP / User-Agent / email などの個人情報は保存しない |

### `publira_aid` Cookie

未ログインの読者を数えるためだけの Cookie です。値はサーバが採番した UUIDv7 で、他の情報は含みません。Cookie が無い場合や値が UUID として読めない場合は新しく採番し、レスポンスの `Set-Cookie` で返します。

| 属性 | 値 |
| --- | --- |
| 名前 | `publira_aid` |
| Path | `/` |
| Max-Age | 180 日（生イベントの保持期間より長く、放置された識別子が残り続けない長さ） |
| その他 | `HttpOnly` / `Secure` / `SameSite=Lax` |

## 評価イベント（rating）

`RatingService.RateContent` は、ログイン中の読者が付けた 1〜5 の評価を `content_events` に記録します。閲覧イベントと違い読者が明示的に行う操作なので、失敗は握り潰さずエラーとして返します。

| 項目 | 値 |
| --- | --- |
| イベント種別 | `rating` |
| actor | `user_id`（ログイン必須。匿名評価は受け付けない） |
| 対象 | シリーズ評価は `series_id` のみ、エピソード評価は `series_id` + `episode_id` |
| `series_id` | クライアント入力ではなく `series` / `episodes` から解決する |
| スコア | `rating_score` 1〜5。範囲外と未設定の 0 は `invalid_argument`（DB 側にも CHECK 制約がある） |
| 追記のみ | 評価し直しても既存行は更新も削除もせず、新しい行を追加する |

評価を取り消す RPC はありません。「どの評価が有効か」は書き込み時ではなく読み出し時に決める設計で、`ListLatestContentRatingsByEntity`（`DISTINCT ON (actor_key)`）が actor ごとの最新の 1 件を返します。

日次集計（`content_daily_stats` の `rating_count` / `rating_sum`）はその日に発生した評価だけを数える**フロー指標**であり、その時点でアイテムが保持している評価の平均（ストック）ではありません。評価し直した読者はどちらの日にも計上され、評価を変えなかった読者は初日以降どの日にも計上されません。ストックの平均が要るときは上記の `DISTINCT ON` を使います。

## API サーバ分離

- 公開 API サーバー: `server/cmd/api-server`
  - 公開サービス: `CatalogService`, `AuthService`
  - 既定ポート: `:8000`
- 管理 API サーバー: `server/cmd/admin-api-server`
  - 管理サービス: `AdminSeriesService`, `AdminAuthService`
  - 既定ポート: `:8001` (`PUBLIRA_ADMIN_API_ADDR` で変更可能)
  - 公開状態変更時の Next.js 再検証: `PUBLIRA_REVALIDATE_TOKEN` を設定
  - 送信先は全 `web-*` の内部 URL（`PUBLIRA_WEB_*_INTERNAL_URL`）

これにより、公開系と管理系を別プロセス・別経路で運用できます。

## DB ユーザー構成

各 API サーバーは専用の PostgreSQL ログインユーザーで接続し、最小権限を実現します。

| サーバー | DB ユーザー | 環境変数 | ローカルデフォルト |
| --- | --- | --- | --- |
| platform-api | `publira_platform` | `PUBLIRA_PLATFORM_DB_URL` | `postgres://publira_platform:platformpass@db:5432/publira?sslmode=disable` |
| admin-api | `publira_admin` | `PUBLIRA_ADMIN_DB_URL` | `postgres://publira_admin:adminpass@db:5432/publira?sslmode=disable` |
| api (public) | `publira_public` | `PUBLIRA_PUBLIC_DB_URL` | `postgres://publira_public:publicpass@db:5432/publira?sslmode=disable` |
| outbox-worker | BYPASSRLS 相当（ローカルは superuser） | `PUBLIRA_WORKER_DB_URL`（未設定時 `PUBLIRA_DB_URL`） | `postgres://postgres:password@db:5432/publira?sslmode=disable` |
| batch aggregate-content-stats | `publira_content_stats`（BYPASSRLS） | `PUBLIRA_CONTENT_STATS_DB_URL`（未設定時 `PUBLIRA_WORKER_DB_URL` → `PUBLIRA_DB_URL`） | `postgres://publira_content_stats:contentstatspass@db:5432/publira?sslmode=disable` |
| batch purge-content-events | `publira_content_stats`（BYPASSRLS） | `PUBLIRA_CONTENT_EVENTS_DB_URL`（未設定時 `PUBLIRA_CONTENT_STATS_DB_URL` → `PUBLIRA_WORKER_DB_URL` → `PUBLIRA_DB_URL`） | `postgres://publira_content_stats:contentstatspass@db:5432/publira?sslmode=disable` |
| batch build-recommend-features | `publira_content_stats` (BYPASSRLS) | `PUBLIRA_RECOMMEND_FEATURES_DB_URL`, falling back to `PUBLIRA_CONTENT_STATS_DB_URL` → `PUBLIRA_WORKER_DB_URL` → `PUBLIRA_DB_URL` | `postgres://publira_content_stats:contentstatspass@db:5432/publira?sslmode=disable` |

`publira_platform` と `publira_content_stats` は BYPASSRLS 属性を持ち、全テナントのデータに横断アクセスします。 `publira_admin` / `publira_public` は RLS が有効で、テナント ID でスコープされます。

### ローカル開発

`task db:setup` 実行時に `db/seeds/baseline/000_rls_bypass_role.sql` が適用され、4 ユーザーが作成されます。

### 本番環境

seed を実行後、各ユーザーのパスワードを安全な値に変更してください:

```sql
ALTER ROLE publira_platform PASSWORD '<secure_password>';
ALTER ROLE publira_content_stats PASSWORD '<secure_password>';
ALTER ROLE publira_admin    PASSWORD '<secure_password>';
ALTER ROLE publira_public   PASSWORD '<secure_password>';
```

次に各サーバーの環境変数 (`PUBLIRA_PLATFORM_DB_URL`, `PUBLIRA_CONTENT_STATS_DB_URL`, `PUBLIRA_ADMIN_DB_URL`, `PUBLIRA_PUBLIC_DB_URL`) にそれぞれのパスワードを含む URL を設定してください。

## 初期データメモ

- AuthService を使うには、最低限 `tenants` と `users` のデータが必要です。
- `users.password_hash` は `bcrypt` ハッシュを利用してください。
- ヘルス確認（API / image-server / Web アプリ共通）:
  - `GET /livez` — プロセス生存確認（liveness）。常に `200` + plain `ok`。K8s livenessProbe 向け。
  - `GET /readyz` — 依存の readiness。正常時 `200`、異常時 `503`。K8s readinessProbe / ロードバランサ向け。
  - API / image-server: 最低限 DB `Ping`
  - Web (`web-admin` / `web-host` / `web-platform`): 上流 API `/readyz` + Redis（`PUBLIRA_REDIS_URL` 無効時は Redis チェックをスキップ）
  - `/readyz` 応答例（JSON）:
    - 正常: `{"status":"ok","checks":{"db":{"status":"ok"}}}`
    - 依存障害: `{"status":"unavailable","checks":{"db":{"status":"error","error":"..."}}}`（HTTP 503）
    - 起動直後ゲート未開放: `{"status":"starting","checks":{...}}`（HTTP 503）
