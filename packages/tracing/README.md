# `@publira/tracing`

Next.js アプリ (`web-host` / `web-admin` / `web-platform`) の `instrumentation.ts` から OpenTelemetry SDK を登録する共有パッケージです。Go 側の [`server/internal/tracing`](../../server/internal/tracing) と同じ環境変数・同じ既定値を使うので、1 つのデプロイ設定でスタック全体のトレースが揃います。

登録の実体は [`@vercel/otel`](https://www.npmjs.com/package/@vercel/otel) です。Next.js が計装済みの span（inbound リクエスト、レンダリング、`fetch`）はこの登録だけで出ます。

## 使い方

```ts
// apps/web-host/instrumentation.ts
import { registerTracing } from "@publira/tracing";

export const register = async () => {
  await import("temporal-polyfill/global");
  registerTracing("publira-web-host");
};
```

引数は `service.name` の既定値です。`OTEL_SERVICE_NAME` / `OTEL_RESOURCE_ATTRIBUTES` で上書きできます。`@vercel/otel` は Node.js ランタイムと Edge ランタイムの両方にビルドを持つため、どちらから呼ばれても壊れません。

## 環境変数

自前の変数は有効化フラグとデプロイ環境の 2 つだけで、あとは OpenTelemetry SDK 自身が読むため名前を変えていません。

| 変数 | 用途 |
| --- | --- |
| `PUBLIRA_TRACING_ENABLED` | トレースの有効化（`true` / `1` / `t`、大文字小文字は無視）。未設定・解釈できない値は無効 |
| `PUBLIRA_DEPLOYMENT_ENVIRONMENT` | `development`（既定） / `staging` / `production`。`deployment.environment.name` と既定サンプリング率を決める |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | 送信先（例: `http://jaeger:4318`） |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf` / `http/json`。gRPC の OTLP は `@vercel/otel` にはありません |
| `OTEL_SERVICE_NAME` / `OTEL_RESOURCE_ATTRIBUTES` | resource 属性の上書き |
| `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG` | サンプラ。設定すると下記の既定を使わず SDK がこの値を解釈する |
| `NEXT_OTEL_VERBOSE` | `1` で Next.js の詳細 span を出す（既定は出さない） |

**既定は無効**です。`PUBLIRA_TRACING_ENABLED` を立てない限り `registerTracing` は何も登録せず、Next.js の計装は OpenTelemetry の no-op provider に記録します。収集基盤が無くてもアプリは起動し、リクエストも通ります。

## resource 属性

| キー | 値 |
| --- | --- |
| `service.name` | `registerTracing` の引数（`publira-web-host` / `publira-web-admin` / `publira-web-platform`）。`OTEL_SERVICE_NAME` で上書き可能 |
| `deployment.environment.name` | `PUBLIRA_DEPLOYMENT_ENVIRONMENT`。未設定なら `development` |
| `node.env` / `process.runtime.name` | `@vercel/otel` が付ける実行環境の情報 |

`@vercel/otel` は Vercel 上でなくても `cloud.provider=vercel` と `vercel.runtime` を付けます。self-host では意味のない値ですが、無害なので打ち消していません。

## サンプリング

Go 側と同じく親準拠（parent-based）で、root span の扱いだけがデプロイ環境で変わります。ブラウザからのリクエストでは Next.js アプリがトレースの起点なので、ここでの判断が下流の Go サービスにそのまま伝わります。

| `PUBLIRA_DEPLOYMENT_ENVIRONMENT`          | root span |
| ----------------------------------------- | --------- |
| `development`（既定）                     | 全件      |
| それ以外（`staging` / `production` など） | 10%       |

## `NEXT_OTEL_VERBOSE`

Next.js は自前の許可リスト（`next/dist/server/lib/trace/constants.js` の `NextVanillaSpanAllowlist`）にある span だけを既定で出します。リクエストの root span、レンダリング、`fetch`、`generateMetadata`、コンポーネントツリーの構築、セグメントモジュールの解決、Route Handler、proxy はこれに含まれるので、通常の調査に必要な粒度は既定のままで揃います。

`NEXT_OTEL_VERBOSE=1` を付けると、許可リストの外にある内部 span（`BaseServer.renderToResponse`、`Router.executeRoute`、`AppRender.renderToReadableStream`、`LoadComponents.loadComponents` など）も出ます。Next.js 自体の内部を追いたいときだけ付けてください。

```bash
NEXT_OTEL_VERBOSE=1 pnpm --dir apps/web-host dev
```

既定で有効にしない理由は、1 リクエストあたりの span 数が大きく増え、アプリのコードでは動かしようのない内部段階でトレース UI が埋まるためです。自分のコードの遅さを探しているなら、付けないほうが読めます。

## トレースの繋がり方

| 区間 | 計装 |
| --- | --- |
| ブラウザ → Next.js の inbound | Next.js 組み込み（`GET /[tenant_id]/[locale]` などの root span） |
| `proxy.ts` | Next.js 組み込み（`middleware GET`）。ページのレンダリングとは**別のトレース**になります |
| SSR → Go API の Connect / gRPC | [`@publira/api-client`](../api-client) の tracing interceptor（client span と `traceparent` の送出） |
| Go API の inbound・DB クエリ | [`server/internal/tracing`](../../server/README.md#distributed-tracing-opentelemetry) |

伝播は W3C Trace Context です。Go の Connect ハンドラは inbound の `traceparent` を親として信頼するので、Web アプリ → API → DB が 1 本のトレースになります。
