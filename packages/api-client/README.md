# api-client

ConnectRPC の TypeScript API クライアントを提供するパッケージです。

## 使い方

`baseUrl` はクライアント公開用環境変数 (`NEXT_PUBLIC_*`) ではなく、サーバー専用の環境変数から読み込んでください。

公開 API クライアント:

```ts
import { createPublicApiClient } from "@publira/api-client/public/client";

const client = createPublicApiClient({
  baseUrl: process.env.PUBLIRA_API_BASE_URL ?? "http://localhost:8080",
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

## 運用ルール

- `src/gen/` 以下は自動生成物 (直接編集しない)
- API 仕様の変更は `proto/` を起点に行い、`make gen` で再生成する
