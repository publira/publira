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

## cursor 一覧の走査

cursor 一覧 RPC をアプリ側で順に辿るときは、共有 helper を使います。ページは token の依存関係に従って逐次取得し、同じ token の再出現とページ数・行数の上限で不正なレスポンスによる無限走査を防ぎます。

既定の上限は `pageSize = 100`、`maxPages = 100`、`maxRows = 10_000` です。上限や繰り返し token に達すると例外は出さず静かに止まります。`findByPublicIdWithToken` はその場合も `null` を返すため、「レコードが無い」と区別できません。単体取得の正規手段はサーバー側の `Get*` RPC です（#799）。

`forEachPageWithToken` は停止理由を返します: `completed` / `stopped-by-callback` / `max-pages` / `max-rows` / `repeated-token`。

まだ cursor に移っていない offset 一覧は `forEachPageWithOffset` を使います。停止理由は `repeated-token` を除いた同じ集合です。最終ページが満杯のまま上限に達したときは `completed` ではなく `max-pages` / `max-rows` です。

### 単体検索

単体取得 RPC がないリソースを `publicId` で探す場合:

```ts
import { findByPublicIdWithToken } from "@publira/api-client/pagination";

const item = await findByPublicIdWithToken(publicId, async (token, limit) => {
  const response = await client.listItems({ limit, token });
  return { items: response.items, nextToken: response.nextToken };
});
// item が null でも「未存在」とは限らない（走査上限の可能性）
```

### 集約・途中打ち切り

一覧を集約する、または十分な件数で打ち切る場合は `forEachPageWithToken` を使います。`onPage` が `false` を返すと次ページを取りません。

```ts
import { forEachPageWithToken } from "@publira/api-client/pagination";

const stop = await forEachPageWithToken(
  async (token, limit) => {
    const response = await client.listItems({ limit, token });
    return { items: response.items, nextToken: response.nextToken };
  },
  (items) => {
    // items を集約する
    return collected.size < needed; // false で打ち切り
  },
  { pageSize: 50 }
);
// stop === "max-pages" | "max-rows" なら一覧が途中までしか読めていない
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
| `rpcErrorHasFieldViolation(error, field)` | `google.rpc.BadRequest` の request field を型付きで判定する |
| `rpcErrorHasReason(error, reason)` | Publira の `google.rpc.ErrorInfo` reason を型付きで判定する |
| `RPC_ERROR_REASON` | Publira が送る `ErrorInfo` reason の定数 |

方針:

- `not_found` と `permission_denied` は区別しない。区別するとレコードの存在有無が漏れる。サーバーは他テナントの行や未公開コンテンツにも `permission_denied` を返す
- `unauthenticated` はセッションの問題なので再ログイン導線に振り分ける
- 分類できないもの (`internal` / `unimplemented` / RPC 由来でない例外) は **握りつぶさず** エラーバウンダリまで伝播させる
- 同じ `Code` の中で文言を選ぶ必要がある場合は、サーバーが付けた `BadRequest` field violation または `ErrorInfo` reason を使う。サーバー本文は読まない

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

### メッセージ本文を分類に使う唯一の箇所

`rpcErrorCode()` は、`ConnectError` の `code` が失われた場合のみ Connect 自身が付ける `[not_found]` 接頭辞を読む。`"use cache"` スコープで投げたエラーは Next.js が `name` と `message` だけから再生成するため、`instanceof` も `code` も残らない。

`rpcErrorHasFieldViolation()` と `rpcErrorHasReason()` は original の `ConnectError` から details を読むため、キャッシュ境界を越えた再生成エラーには `false` を返します。details が必要な分類は、必ず `"use cache"` 境界の内側で完了させます。RPC 由来でない `Error` はいずれの helper にも一致せず、`new Error("[not_found] …")` のような値が `rethrowUnclassifiedRpcError()` をすり抜けることはありません。

## 運用ルール

- `src/gen/` 以下は自動生成物 (直接編集しない)
- API 仕様の変更は `proto/` を起点に行い、`make gen` で再生成する
