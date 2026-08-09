# api-client

ConnectRPC の TypeScript API クライアントを提供するパッケージです。

## 使い方

`baseUrl` はクライアント公開用環境変数 (`NEXT_PUBLIC_*`) ではなく、サーバー専用の環境変数から読み込んでください。

公開 API クライアント:

```ts
import { createPublicApiClient } from "@publira/api-client/public/client";

const client = createPublicApiClient({
  baseUrl: process.env.PUBLIRA_API_BASE_URL ?? "http://localhost:8080",
  tenantPublicId: "TENANT001",
});

await client.catalog.getSeriesDetail({
  tenant: { tenantSlug: "demo" },
  seriesSlug: "example-series",
});
```

管理 API クライアント:

```ts
import { createAdminApiClient } from "@publira/api-client/admin/client";

const client = createAdminApiClient({
  baseUrl: process.env.PUBLIRA_ADMIN_API_BASE_URL ?? "http://localhost:8081",
  tenantPublicId: () => currentTenantPublicId,
});

await client.auth.getMe({
  tenant: { tenantSlug: "demo" },
  sessionId: "session-id",
});
```

型だけ使う場合:

```ts
import type { CreateSessionRequest } from "@publira/api-client/public/auth";
import type { AdminAuthServiceGetMeRequest } from "@publira/api-client/admin/auth";
```

## テナントヘッダー

`tenantPublicId` を指定すると、すべての API リクエストに `X-Publira-Tenant-Public-Id` ヘッダーが自動で付与されます。

- 固定値: `tenantPublicId: "TENANT001"`
- 動的値: `tenantPublicId: () => selectedTenantPublicId`

## エラー分類

RPC エラーの分類は **必ず Connect の `Code`** で行います。`error.message.includes("not found")` のようなメッセージ文字列マッチは、サーバー側の文言変更で静かに壊れるため禁止です (#645)。

```ts
import {
  Code,
  isMissingResourceRpcError,
  isRpcError,
  rethrowUnclassifiedRpcError,
} from "@publira/api-client/errors";
```

| API | 用途 |
| --- | --- |
| `rpcErrorCode(error)` | `Code \| null`。RPC 由来でなければ `null` |
| `isRpcError(error, ...codes)` | 指定した `Code` のいずれかに一致するか |
| `rpcErrorDisposition(error)` | `Code` をまとめた処理カテゴリ (`not-found` / `forbidden` / `unauthenticated` / `invalid-argument` / `conflict` / `precondition` / `unavailable` / `unexpected`) |
| `isMissingResourceRpcError(error)` | `not_found` または `permission_denied`。「表示するものが無い」= 404 相当 |
| `isUnauthenticatedRpcError(error)` | `unauthenticated`。再認証導線へ |
| `isExpectedNullableRpcError(error)` | 上記 2 つの合併。セッション付き読み取りが `null` を返してよい範囲 |
| `isRejectedRequestRpcError(error)` | サーバーがリクエスト自体を拒否した範囲。フォームがメッセージとして出してよい |
| `rethrowUnclassifiedRpcError(error)` | 分類できないものだけ再 throw。メッセージ化する `catch` の先頭で呼ぶ |
| `rpcErrorRawMessage(error)` | `[code]` 接頭辞を除いたサーバー本文。**運用者向けに書かれた文言を通す用途のみ** |
| `rpcErrorMentions(error, token)` | **分類済みカテゴリの中で文言を選ぶためだけ** のエスケープハッチ (後述) |

方針:

- `not_found` と `permission_denied` は区別しない。区別するとレコードの存在有無が漏れる。サーバーは他テナントの行や未公開コンテンツにも `permission_denied` を返す
- `unauthenticated` はセッションの問題なので再ログイン導線に振り分ける
- 分類できないもの (`internal` / `unimplemented` / RPC 由来でない例外) は **握りつぶさず** エラーバウンダリまで伝播させる

```ts
try {
  return { ok: true, series: await fetchSeries() };
} catch (error) {
  rethrowUnclassifiedRpcError(error);
  return { message: rpcErrorMessage(error, genericMessage), ok: false };
}
```

文言は `@publira/api-client/error-messages` の `rpcErrorMessage(error, fallback, overrides?)` に集約しています。3 アプリで同じ RPC エラーが同じ文言になるよう、共通表をここに置いています。

```ts
import { rpcErrorMessage } from "@publira/api-client/error-messages";

return {
  message: rpcErrorMessage(
    error,
    "著者の保存に失敗しました。時間をおいて再試行してください。",
    {
      "invalid-argument": "画像の設定を確認してください。",
    }
  ),
  ok: false,
};
```

### メッセージ文字列を読む 2 箇所

1. `rpcErrorCode()` は、`ConnectError` の `code` が失われた場合のみ Connect 自身が付ける `[not_found]` 接頭辞を読む。`"use cache"` スコープで投げたエラーは Next.js が `name` と `message` だけから再生成するため、`instanceof` も `code` も残らない
2. `rpcErrorMentions()` は `domain already exists` と `admin_domain already exists` のようなフィールド差を見分ける。`Code` にフィールド情報は無く、サーバーは `google.rpc.BadRequest` details をまだ付けていない (#642)。**分類済みのカテゴリ内で文言を選ぶ用途に限る**

どちらも `name === "ConnectError"` を持つ値だけを対象にします。RPC 由来でない `Error` は分類されず (`rpcErrorCode()` は `null`、`rpcErrorMentions()` は `false`)、`new Error("[not_found] …")` のような値が `rethrowUnclassifiedRpcError()` をすり抜けることはありません。

## 運用ルール

- `src/gen/` 以下は自動生成物 (直接編集しない)
- API 仕様の変更は `proto/` を起点に行い、`make gen` で再生成する
