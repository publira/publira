# `@publira/web-session`

The package that holds the browser session cookie for the Next.js apps. It seals the API access token into a JWE, opens it again, and builds the `Authorization` header the sealed token is there to produce.

All three consoles (`web-storefront`, `web-admin`, `web-platform`) use it, and each keeps its own cookie name and cache tag. What is shared is the envelope, not the cookie: the payload shape, the encryption, the expiry check, and the cookie attributes.

The session itself is issued by the Go API. Nothing here signs a token or decides who is signed in — it only carries what the API returned across requests.

## Subpaths

| Import | What it provides |
| --- | --- |
| `@publira/web-session` | Sealing, opening, and the cookie attributes for the session cookie, and the login device cookie beside it |
| `@publira/web-session/cookie-name` | `profileCookieName`, the local development profile suffix for **any** cookie name |

`./cookie-name` is separate because it has nothing to do with sessions and is imported from places that have no business pulling in `jose` — `@publira/i18n` names the locale cookies through it.

## What it provides

| Export | What it does |
| --- | --- |
| `WebSessionPayload` | What the cookie carries: `accessToken` and `expiresAt`, plus the optional `name` / `publicId` / `role` / `tenantId` |
| `SealPurpose` | What a sealed value is for. Each purpose has a key of its own, derived from the secret with HKDF-SHA-256, so a value sealed for one cookie does not open as another |
| `encryptPayload(payload, secret, purpose)` | Seals any JSON payload into a compact JWE (`alg: "dir"`, `enc: "A256GCM"`) under that purpose's key |
| `decryptPayload(token, secret, purpose)` | Opens one, as `unknown` for the caller to validate, or `null` when the value is not one this deployment sealed for that purpose |
| `encryptSessionPayload(payload, secret)` | `encryptPayload` for a `WebSessionPayload`, under the `session` purpose |
| `decryptSessionPayload(token, secret)` | Opens it, or `null` when the cookie is unreadable, is not JSON, or lacks `accessToken` / `expiresAt` |
| `isSessionExpired(expiresAt, now?)` | Whether the stored expiry has passed. An unparseable value counts as expired |
| `resolveAuthSecret()` | Reads `PUBLIRA_AUTH_SECRET` and rejects one shorter than 32 bytes |
| `sessionCookieOptions(expiresAt)` | The cookie attributes: `httpOnly`, `path: "/"`, `sameSite: "lax"`, `expires`, and `secure` in production |
| `LoginDevice` | The login device token a `Login` response carries, with its expiry as a `Temporal.Instant` |
| `toLoginDevice(device)` | Reads the `device` of a `Login` response, or `null` when it is absent, its token is empty, or its expiry is not an instant |
| `loginDeviceCookie(name, device)` | The cookie that keeps the token: the session cookie's attributes, expiring with the device. Each app names its own and leaves it in place on sign-out |
| `buildBearerHeaders(accessToken)` | The per-call options that put `Authorization: Bearer …` on a ConnectRPC call |
| `profileCookieName(baseName)` | `baseName` with the local development profile suffix appended |

## Environment variables

| Variable | What it does |
| --- | --- |
| `PUBLIRA_AUTH_SECRET` | **Required**, with no fallback. The key the session cookie is sealed with. At least 32 bytes, and a shorter value is rejected rather than stretched. Every byte counts: each cookie's A256GCM key is derived from the whole value, so changing any part of it signs everyone out. The cookie carries the API access token, so whoever holds the key can both read and forge a session: issue one per environment, for example with `openssl rand -base64 32` |
| `PUBLIRA_COOKIE_SUFFIX` | Optional, development only. Appended to every name that goes through `profileCookieName`, so two local profiles on two ports of `localhost` do not overwrite each other's cookies. Must match `-[a-z][a-z0-9-]{0,31}`. Deployments leave it unset |

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

An unreadable cookie is "no session" and answers `null`; an unusable key throws. Each app wraps this read in its own `"use cache: private"` function tagged with its session cache tag, so the Server Action that changes the cookie can invalidate it with `updateTag`.

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
  "publira_web_storefront_auth"
);
```

Every cookie the apps set goes through this, not only the session one.

## Commands

```bash
pnpm run test --filter @publira/web-session
pnpm typecheck --filter @publira/web-session
pnpm build --filter @publira/web-session
```
