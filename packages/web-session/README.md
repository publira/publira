# `@publira/web-session`

The package that holds the browser session cookie for the Next.js apps. It seals the API access token into a JWE, opens it again, and builds the `Authorization` header the sealed token is there to produce.

All three consoles (`web-host`, `web-admin`, `web-platform`) use it, and each keeps its own cookie name and cache tag. What is shared is the envelope, not the cookie: the payload shape, the encryption, the expiry check, and the cookie attributes.

The session itself is issued by the Go API. Nothing here signs a token or decides who is signed in — it only carries what the API returned across requests.

## Subpaths

| Import | What it provides |
| --- | --- |
| `@publira/web-session` | Sealing, opening, and the cookie attributes for the session cookie |
| `@publira/web-session/cookie-name` | `profileCookieName`, the local development profile suffix for **any** cookie name |

`./cookie-name` is separate because it has nothing to do with sessions and is imported from places that have no business pulling in `jose` — `@publira/i18n` names the locale cookies through it.

## What it provides

| Export | What it does |
| --- | --- |
| `WebSessionPayload` | What the cookie carries: `accessToken` and `expiresAt`, plus the optional `name` / `publicId` / `role` / `tenantId` |
| `encryptSessionPayload(payload, secret)` | Seals the payload into a compact JWE (`alg: "dir"`, `enc: "A256GCM"`) |
| `decryptSessionPayload(token, secret)` | Opens it, or `null` when the cookie is unreadable, is not JSON, or lacks `accessToken` / `expiresAt` |
| `isSessionExpired(expiresAt, now?)` | Whether the stored expiry has passed. An unparseable value counts as expired |
| `resolveAuthSecret()` | Reads `PUBLIRA_AUTH_SECRET` and rejects a value too short to key A256GCM |
| `sessionCookieOptions(expiresAt)` | The cookie attributes: `httpOnly`, `path: "/"`, `sameSite: "lax"`, `expires`, and `secure` in production |
| `buildBearerHeaders(accessToken)` | The per-call options that put `Authorization: Bearer …` on a ConnectRPC call |
| `profileCookieName(baseName)` | `baseName` with the local development profile suffix appended |

## Environment variables

| Variable | What it does |
| --- | --- |
| `PUBLIRA_AUTH_SECRET` | **Required.** The key the session cookie is sealed with. At least 32 bytes — A256GCM takes exactly that many |
| `PUBLIRA_COOKIE_SUFFIX` | Optional, development only. Appended to every name that goes through `profileCookieName`. Must match `-[a-z][a-z0-9-]{0,31}` |

There is deliberately no fallback secret. A built-in value would be published in this repository, and it keys a JWE whose payload carries the API access token — anyone holding it could forge a session cookie or read one. A secret shorter than 32 bytes is rejected rather than quietly padded, because a secret that was set but does not take effect is the failure mode that is hardest to notice.

`PUBLIRA_COOKIE_SUFFIX` exists because cookies are scoped by host and not by port. Two local development profiles serving the same app on two ports of `localhost` would otherwise overwrite each other's session. Deployments leave it unset and keep their established cookie names.

## Usage

### Issuing the cookie

```ts
import {
  encryptSessionPayload,
  resolveAuthSecret,
  sessionCookieOptions,
} from "@publira/web-session";
import { cookies } from "next/headers";

const sealed = await encryptSessionPayload(
  {
    accessToken: result.accessToken,
    expiresAt: result.expiresAt.toISOString(),
    tenantId,
  },
  resolveAuthSecret()
);

const cookieStore = await cookies();
cookieStore.set({
  ...sessionCookieOptions(result.expiresAt),
  name: PUBLIC_SESSION_COOKIE_NAME,
  value: sealed,
});
```

### Reading it back

```ts
import {
  decryptSessionPayload,
  isSessionExpired,
  resolveAuthSecret,
} from "@publira/web-session";

const raw = cookieStore.get(PUBLIC_SESSION_COOKIE_NAME)?.value?.trim() ?? "";
if (!raw) {
  return "";
}

const payload = await decryptSessionPayload(raw, resolveAuthSecret());
if (!payload || isSessionExpired(payload.expiresAt)) {
  return "";
}

return payload.accessToken.trim();
```

The two failures are told apart on purpose. A cookie that cannot be opened is "no session", and the visitor goes to the login screen. An unusable **key** is a misconfigured deployment, so `resolveAuthSecret` and the key derivation throw instead — sending every visitor to the login screen would hide the outage behind what looks like ordinary sign-out.

Each app wraps this read in its own `"use cache: private"` function tagged with its session cache tag, so the Server Action that changes the cookie can invalidate it with `updateTag`.

### Calling the API with the token

```ts
import { buildBearerHeaders } from "@publira/web-session";

await apiClient.auth.getMe(
  { tenant: { tenantId } },
  buildBearerHeaders(accessToken)
);
```

### Naming a cookie

```ts
import { profileCookieName } from "@publira/web-session/cookie-name";

export const PUBLIC_SESSION_COOKIE_NAME = profileCookieName(
  "publira_web_host_auth"
);
```

Every cookie the apps set goes through this, not only the session one.

## Commands

```bash
pnpm --filter @publira/web-session test
pnpm --filter @publira/web-session typecheck
pnpm --filter @publira/web-session build
```
