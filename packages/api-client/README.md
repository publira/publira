# api-client

The package that provides the ConnectRPC TypeScript API clients.

## Usage

Read `baseUrl` from a server-only environment variable, not from a client-exposed one (`NEXT_PUBLIC_*`).

The public API client:

```ts
import { createPublicApiClient } from "@publira/api-client/public/client";

const client = createPublicApiClient({
  baseUrl: process.env.PUBLIRA_API_BASE_URL ?? "http://localhost:8080",
  tenantId,
});

await client.catalog.getSeriesDetail({
  publicId: "SeedSERSAAA1",
  tenant: { tenantId },
});
```

`tenantId` and `tenant.tenantId` are both the tenant's primary key (a UUID); `publicId` is the series' 12-character public ID, which resolves the series a URL names.

The admin API client:

```ts
import { createAdminApiClient } from "@publira/api-client/admin/client";
import { buildBearerHeaders } from "@publira/web-session";

const client = createAdminApiClient({
  baseUrl: process.env.PUBLIRA_ADMIN_API_BASE_URL ?? "http://localhost:8081",
  tenantId: () => currentTenantId,
});

await client.auth.getMe(
  { tenant: { tenantId: currentTenantId } },
  buildBearerHeaders(accessToken)
);
```

A request carries no session of its own: the session travels as the `Authorization` header, which `buildBearerHeaders` from `@publira/web-session` builds from the access token the app's session cookie holds.

Using the types alone:

`@publira/api-client/admin/types` re-exports the shared `publira.types.v1` messages plus the admin.v1 entities that web-admin's mappers `Pick` from. `@publira/api-client/public/types` puts the same shared messages next to the publira.v1 entities web-host `Pick`s from, and `@publira/api-client/platform/types` does the same for the platform.v1 entities. In all three, the request and response types stay on the per-service modules.

```ts
import type { AdminAuthServiceGetMeRequest } from "@publira/api-client/admin/auth";
import type {
  Series,
  AdminAccessTicket,
} from "@publira/api-client/admin/types";
import type { Tenant } from "@publira/api-client/platform/types";
import type { LoginRequest } from "@publira/api-client/public/auth";
import type { MyPurchase } from "@publira/api-client/public/types";
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

With `tenantId` set, every API request automatically carries the `X-Publira-Tenant-Id` header, which holds the tenant's primary key (UUID). Without it, a request message's top-level or nested `tenant.tenantId` fills the header instead.

- A fixed value: `tenantId: "018f0e6a-1000-7000-8000-000000000001"`
- A dynamic value: `tenantId: () => selectedTenantId`

## The client's address

The server determines the client's address from the forwarded headers of the call, walking them from the right past every trusted proxy, so a web app passes on what it received and adds itself to the chain as any proxy does. Two modules do that.

`@publira/api-client/forwarded-hop` exports `appendPeerAddressOnEveryRequest()`, which an app calls from `register()` in `instrumentation.ts`, and `appendPeerAddress(headers, peerAddress)`, what it applies to each request the process's HTTP server receives: the address the request arrived from is appended to the `X-Forwarded-For` and the `Forwarded` that arrived, and becomes an `X-Forwarded-For` of its own when neither did.

`@publira/api-client/forwarded` exports `forwardedHeadersOf(headers)`, which picks `X-Forwarded-For` and `Forwarded` out of the request being served as they are, and `createForwardedInterceptor(resolve)`, which sets them from `resolve()` on every call that carries `Authorization`. A call that sets either header itself keeps it, which is how a sessionless call passes them on; `serviceCallContextValues()` is the `contextValues` of a call made with the web service credential, which the interceptor leaves alone.

```ts
// instrumentation.ts
export const register = async () => {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { appendPeerAddressOnEveryRequest } =
      await import("@publira/api-client/forwarded-hop");
    appendPeerAddressOnEveryRequest();
  }
};
```

```ts
import { createAdminApiClient } from "@publira/api-client/admin/client";
import {
  createForwardedInterceptor,
  forwardedHeadersOf,
} from "@publira/api-client/forwarded";
import { headers } from "next/headers";

const readForwardedHeaders = async () => forwardedHeadersOf(await headers());

export const apiClient = createAdminApiClient({
  baseUrl,
  interceptors: [createForwardedInterceptor(readForwardedHeaders)],
  transport: "grpc",
});
```

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
| `rpcErrorHasFieldViolation(error, field, reason?)` | Type-safe check for a `google.rpc.BadRequest` request field, optionally narrowed to one of `RPC_FIELD_VIOLATION_REASON` |
| `rpcErrorHasReason(error, reason)` | Type-safe check for a Publira `google.rpc.ErrorInfo` reason |
| `rpcErrorReasonMetadataNumber(error, reason, key)` | Numeric `ErrorInfo` metadata for a Publira reason, or `null` |
| `RPC_ERROR_REASON` | The constants for the `ErrorInfo` reasons Publira sends |
| `RPC_FIELD_VIOLATION_REASON` | The constants for the `BadRequest` field-violation reasons Publira sends |
| `RPC_ERROR_METADATA` | The constants for the `ErrorInfo` metadata keys Publira sends |

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
