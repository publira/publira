# web-platform

The cross-tenant operations console for platform operators. Its responsibilities are kept separate from web-admin, which covers operations inside a single tenant.

## Information architecture

### Authentication and authorization

- `proxy.ts` protects every path that is not in `PUBLIC_PATHS` (`/login`, `/mfa`, `/livez`, `/readyz`, `/confirm-email`, `/confirm-password`, `/reset-password`, `/reset-password/requested`, `/setup`)
- There is no `/logout` route. Signing out goes through the header's Server Action only
- Session cookie: `publira_web_platform_auth`
- Roles: `platform_super_admin`, `platform_operator`, `platform_auditor` (`server/internal/auth/roles.go`; their permissions are in `server/cmd/publira/README.md`)
- Screens are guarded in `(protected)/layout.tsx`

### Shared layout (app shell)

- Left: sidebar (main navigation plus a note on the responsibility split)
- Top: header (the current operator plus the main actions)
- Body: `PlatformPage` gives every page the same page header and content container
- Mobile: the sidebar is reused as a drawer

### UI locale

The locale is never in the URL. It lives in the `publira_locale` cookie, and resolves cookie → the saved platform default locale.

| Part | Where it lives |
| --- | --- |
| The resolved locale | `getPlatformLocale()` in `lib/locale.ts`, and the cookie options the switcher writes with |
| The saved platform default | `lib/platform-settings.ts`, behind the Default language card on `/general` |
| The locale a screen with nothing saved yet opens on | `getInitialLocaleCandidate()` in `lib/initial-locale.ts`, over the request's `Accept-Language` |
| The catalog | `loadPlatformMessages(locale)` in `lib/messages.ts`, over the repo-root [`locales/*.json`](../../locales/README.md); this app's copy is the `platform.*` namespace |
| One string, where a node cannot go | `getMessages()` in `lib/get-messages.ts` for the request's locale, `getMessagesFor(locale)` in `lib/messages.ts` where the caller holds one |
| One string on the server | `<Message>` in `components/message.tsx`, and `SetupMessage` in `app/setup/_components/` for `/setup` |
| One string in a Client Component | `<ClientMessage>` / `useClientMessages()` in `components/client-message.tsx`, over the `platform` namespace `PlatformMessagesProvider` (`components/platform-messages-provider.tsx`) carries from `app/layout.tsx`, loaded by `loadPlatformClientMessages(locale)` |
| One string in a route-level `error.tsx` | `<ErrorBoundaryMessage>` in `components/error-boundary-message.tsx`, for `app/error.tsx` and `app/(protected)/error.tsx` |
| `<html lang>` | The inline `<head>` script in `app/layout.tsx` (`LOCALE_LANG_SCRIPT` in `@publira/i18n`) |
| The default the browser learns from | The `publira_resolved_locale` cookie `proxy.ts` publishes (`@publira/utils/resolved-locale`) |

An operator switches locale from the Display language switcher in the console header (`components/locale-switcher.tsx`), through the `setPlatformLocaleAction` Server Action in `lib/locale-action.ts`.

A new tenant's default language is not taken from the platform default: `/tenants/new` carries its own selector (`_components/tenant-default-locale-select.tsx`), and `/setup` saves the platform's first one from the selector on that screen.

## Development

```bash
pnpm dev --filter @publira/web-platform
```

### API connection

- `PUBLIRA_GRPC_URL` — the internal listener of `publira server`, which every server-side RPC is made on (`http://localhost:8100` when unset)
- `PUBLIRA_WEB_SERVICE_TOKEN` (required) — the server's `PUBLIRA_WEB_SERVICE_TOKEN`, which the console reads platform-level data with as itself rather than as an operator: the tenants and their members and admin invitations, the platform settings and policies, the email and storage settings, the dashboard, the operators, and the end users, each cached once for every operator. The app refuses to start without it. See [Web service credential](../../server/README.md#web-service-credential)

### Server cache (Redis)

`next.config.ts` wires `@publira/next-cache-handlers`, as web-host does.

- `PNCH_REDIS_URL` (the same value as the server's `PUBLIRA_REDIS_URL`)
- `PNCH_CACHE_APP=web-platform` (set by the `dev` and `start` scripts; it separates the key space)

### Internal cache revalidation

`POST /api/v1/revalidate` is the revalidation entry point reserved for the Go server. It checks `PNCH_REVALIDATE_TOKEN`, set to the server's `PUBLIRA_REVALIDATE_TOKEN`, against the `X-Revalidate-Token` header and calls `revalidateTag(tag, "max")` on the tags it receives (`@publira/next-cache-handlers/revalidate`), without restricting them by tenant ID. This path bypasses the setup check and the session authentication in `proxy.ts`. The destination is `PUBLIRA_WEB_PLATFORM_INTERNAL_URL` on the private network.

### Distributed tracing

`instrumentation.ts` calls `registerTracing("publira-web-platform")` from `@publira/tracing`, which emits Next.js inbound spans and client spans for the Connect RPCs made during SSR. It is off by default and only registers when `PUBLIRA_TRACING_ENABLED` is set. In the Dev Container, look for the `publira-web-platform` service in the Jaeger UI (`http://localhost:16686`).

For the environment variables and how `NEXT_OTEL_VERBOSE` is handled, see [`packages/tracing/README.md`](../../packages/tracing/README.md).

### Session cookie (JWE)

Required environment variables:

- `PUBLIRA_AUTH_SECRET` (32 bytes or more) — the key that seals the platform console's session cookie. There is no fallback: an unset or too short value raises. For the details and how to issue one, see the [repository README](../../README.md#session-cookie-encryption-key-publira_auth_secret)

### Second factor (MFA)

A password that is accepted but still owes a second factor earns a short-lived challenge instead of a session. `/mfa` is the screen that spends it — a public path in `proxy.ts`, because it is reached without a session — and an operator manages their own factor from the Two-step verification card on `/account`.

| Part | Where it lives |
| --- | --- |
| The challenge and its `publira_web_platform_mfa` cookie | `lib/mfa-challenge.ts` |
| The session cookie both sign-in steps write | `lib/platform-session-cookie.ts` |
| The console's MFA RPCs | `lib/platform-mfa.ts` |
| The `verify` and `enroll` screens | `app/mfa/` |
| The operator's own factor | `app/(protected)/account/_components/mfa-settings-card.tsx` |
| The enrollment QR code | `components/mfa-enrollment-secret.tsx`, drawn by `@publira/ui-components/qr-code` |
