# api-client

The package that provides the ConnectRPC TypeScript API clients.

## Usage

Read `baseUrl` from a server-only environment variable, not from a client-exposed one (`NEXT_PUBLIC_*`).

The public API client:

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

The admin API client:

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

Using the types alone:

`@publira/api-client/admin/types` re-exports the shared `publira.types.v1` messages plus the admin.v1 entities that web-admin's mappers `Pick` from. `@publira/api-client/public/types` puts the same shared messages next to the publira.v1 entities web-host `Pick`s from, and `@publira/api-client/platform/types` does the same for the platform.v1 entities. In all three, the request and response types stay on the per-service modules.

```ts
import type {
  Series,
  AdminAccessTicket,
} from "@publira/api-client/admin/types";
import type { Tenant } from "@publira/api-client/platform/types";
import type { MyPurchase } from "@publira/api-client/public/types";
import type { CreateSessionRequest } from "@publira/api-client/public/auth";
import type { AdminAuthServiceGetMeRequest } from "@publira/api-client/admin/auth";
```

## Walking a cursor list

`@publira/api-client/pagination` walks a cursor list RPC page by page from an app. The defaults are `pageSize = 100`, `maxPages = 100`, and `maxRows = 10_000`, and `forEachPageWithToken` resolves to why it stopped: `completed` / `stopped-by-callback` / `max-pages` / `max-rows` / `repeated-token`.

### Looking one record up

To find a resource by `publicId` when it has no single-record RPC:

```ts
import { findByPublicIdWithToken } from "@publira/api-client/pagination";

const item = await findByPublicIdWithToken(publicId, async (token, limit) => {
  const response = await client.listItems({ limit, token });
  return { items: response.items, nextToken: response.nextToken };
});
// A null item does not prove the record is absent (the walk may have hit a limit)
```

### Aggregating, and stopping early

Use `forEachPageWithToken` to aggregate a list or to stop once you have enough. Returning `false` from `onPage` skips the next page.

```ts
import { forEachPageWithToken } from "@publira/api-client/pagination";

const stop = await forEachPageWithToken(
  async (token, limit) => {
    const response = await client.listItems({ limit, token });
    return { items: response.items, nextToken: response.nextToken };
  },
  (items) => {
    // aggregate items
    return collected.size < needed; // false stops the walk
  },
  { pageSize: 50 }
);
// stop === "max-pages" | "max-rows" | "repeated-token" means the list was only read partway
```

## The tenant header

With `tenantPublicId` set, every API request automatically carries the `X-Publira-Tenant-Public-Id` header.

- A fixed value: `tenantPublicId: "TENANT001"`
- A dynamic value: `tenantPublicId: () => selectedTenantPublicId`

## Distributed tracing

`createPublicApiClient`, `createAdminApiClient`, and `createPlatformApiClient` always install `createTracingInterceptor` from `src/tracing.ts`, which opens a client span per RPC (named `AdminSeriesService/ListSeries`, with the `rpc.*` and `server.*` attributes) and sends W3C Trace Context. There is nothing to configure. For registering the SDK on the Next.js side, see [`@publira/tracing`](../tracing).

## Error classification

Classify an RPC error **by Connect's `Code`, always**. Matching on the message string, as in `error.message.includes("not found")`, breaks silently when the server's wording changes, and is forbidden.

```ts
import {
  Code,
  isMissingResourceRpcError,
  isRpcError,
  rethrowUnclassifiedRpcError,
} from "@publira/api-client/errors";
```

| API | What it is for |
| --- | --- |
| `rpcErrorCode(error)` | `Code \| null`; `null` when the error did not come from an RPC |
| `isRpcError(error, ...codes)` | Whether it matches any of the given `Code`s |
| `rpcErrorDisposition(error)` | The handling category the `Code`s roll up into (`not-found` / `forbidden` / `unauthenticated` / `invalid-argument` / `conflict` / `precondition` / `unavailable` / `unexpected`) |
| `isMissingResourceRpcError(error)` | `not_found` or `permission_denied`; "there is nothing to show", the equivalent of a 404 |
| `isUnauthenticatedRpcError(error)` | `unauthenticated`; send the user to re-authenticate |
| `isExpectedNullableRpcError(error)` | The union of the two above: where a read with a session may return `null` |
| `isRejectedRequestRpcError(error)` | The range where the server rejected the request itself; a form may show it as a message |
| `rethrowUnclassifiedRpcError(error)` | Rethrows only what cannot be classified. Call it first in a `catch` that turns errors into messages |
| `rpcErrorRawMessage(error)` | The server's body with the `[code]` prefix stripped. **Only for passing through wording written for an operator** |
| `rpcErrorHasFieldViolation(error, field)` | Type-safe check for a `google.rpc.BadRequest` request field |
| `rpcErrorHasReason(error, reason)` | Type-safe check for a Publira `google.rpc.ErrorInfo` reason |
| `RPC_ERROR_REASON` | The constants for the `ErrorInfo` reasons Publira sends |

```ts
try {
  return { ok: true, series: await fetchSeries() };
} catch (error) {
  rethrowUnclassifiedRpcError(error);
  return { message: rpcErrorMessage(error, genericMessage), ok: false };
}
```

The copy is collected in `rpcErrorMessage(error, fallback, options?)` from `@publira/api-client/error-messages`. So that the same RPC error reads the same across all three apps, the shared table lives in the repo-root `locales/*.json` (`errors.rpc.*`).

```ts
import { rpcErrorMessage } from "@publira/api-client/error-messages";

return {
  message: rpcErrorMessage(
    error,
    "著者の保存に失敗しました。時間をおいて再試行してください。",
    {
      locale,
      overrides: {
        "invalid-argument": "画像の設定を確認してください。",
      },
    }
  ),
  ok: false,
};
```

`rpcErrorCode()` in `src/errors.ts` is the one place in the repository that reads a message body, and `src/errors.test.ts` is the specification of what each helper answers.

## Working rules

- Everything under `src/gen/` is generated; never edit it by hand
- An API change starts in `proto/`, then `task gen` regenerates the client
