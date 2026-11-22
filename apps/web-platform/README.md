# web-platform

The cross-tenant operations console for platform operators. Its responsibilities are kept separate from web-admin, which covers operations inside a single tenant.

## Information architecture

### Authentication and authorization

- `proxy.ts` protects every path that is not in `PUBLIC_PATHS` (`/.well-known/change-password`, `/login`, `/mfa`, `/livez`, `/readyz`, `/confirm-email`, `/confirm-password`, `/reset-password`, `/reset-password/requested`, `/setup`)
- There is no `/logout` route. Signing out goes through the header's Server Action only
- Session cookie: `publira_web_platform_auth`
- Roles: `platform_super_admin`, `platform_operator`, `platform_auditor` (`server/internal/auth/roles.go`; their permissions are in `server/cmd/publira/README.md`)
- Screens are guarded in `app/[locale]/(protected)/layout.tsx`

### Shared layout (app shell)

- Left: sidebar (main navigation plus a note on the responsibility split)
- Top: header (the current operator plus the main actions)
- Body: `ConsolePage` from `@publira/layouts/admin/console-page` gives every page the same page header and content container
- Mobile: the sidebar is reused as a drawer

### UI locale

The locale is never in the URL. It lives in the `publira_locale` cookie, and resolves cookie → the saved platform default locale → `Accept-Language` before setup has saved one. `proxy.ts` resolves it on every page request and rewrites the request onto the `app/[locale]/` root segment, so the URLs an operator sees carry no locale, and one that starts with a locale answers 404. The Route Handlers (`app/api/`, `app/.well-known/change-password/`) and the health probes stay at the root of `app/` and are not rewritten.

| Part | Where it lives |
| --- | --- |
| The locale a page renders in | `getLocale()` in `lib/locale.ts`, the `[locale]` root parameter |
| The locale where there is no root parameter | `getPlatformLocale()` in `lib/locale.ts`, from the cookie, for the Server Actions and the `api/v1/audit-logs/csv` Route Handler, and the cookie options the switcher writes with |
| The saved platform default | `lib/platform-settings.ts`, behind the Default language card on `/general` |
| `Accept-Language`, where nothing is saved yet | `getInitialLocaleCandidate()` in `lib/initial-locale.ts`: the option the default-language selectors on `/setup` and Create tenant open on, and the locale the setup Action words its failures in when no supported `publira_locale` cookie is set |
| The catalog | `loadPlatformMessages(locale)` in `lib/messages.ts`, over the repo-root [`locales/*.json`](../../locales/README.md); this app's copy is the `platform.*` namespace |
| One string, where a node cannot go | `getMessages()` in `lib/get-messages.ts` for the request's locale, `getMessagesFor(locale)` in `lib/messages.ts` where the caller holds one |
| One string on the server | `<Message>` in `components/message.tsx` |
| One string in a Client Component | `<ClientMessage>` / `useClientMessages()` in `components/client-message.tsx`, over the `platform` namespace `PlatformMessagesProvider` (`components/platform-messages-provider.tsx`) carries from `app/[locale]/layout.tsx`, loaded by `loadPlatformClientMessages(locale)` |
| One string in a route-level `error.tsx` | `<ClientMessage>` in `components/client-message.tsx`, over `PlatformMessagesProvider` in `app/[locale]/layout.tsx`, for `app/[locale]/error.tsx` and `app/[locale]/(protected)/error.tsx` |
| `<html lang>` | The inline `<head>` script in `app/[locale]/layout.tsx` (`LOCALE_LANG_SCRIPT` in `@publira/i18n`), and `<DocumentLocale>` in `components/document-locale.tsx`, which applies it again when a change of language remounts that layout |
| The default the browser learns from | The `publira_resolved_locale` cookie `proxy.ts` publishes (`@publira/utils/resolved-locale`) |

An operator switches locale from the Display language switcher in the console header (`components/locale-switcher.tsx`), through the `setPlatformLocaleAction` Server Action in `lib/locale-action.ts`; `components/locale-switcher-root.tsx` refreshes the route once it settles, which sends the screen back through `proxy.ts` on the new cookie.

A new tenant's default language is not taken from the platform default: `/tenants/new` carries its own selector, beside the languages the new tenant's site offers (`_components/tenant-locales-fields.tsx`), and `/setup` saves the platform's first one from the selector on that screen.

## Development

```bash
pnpm dev --filter @publira/web-platform
```

### API connection

- `PUBLIRA_GRPC_URL` — the `/rpc` base URL on `publira server`, which every server-side RPC is made on (`http://localhost:8000/rpc` when unset)
- `PUBLIRA_WEB_SERVICE_TOKEN` (required) — the server's `PUBLIRA_WEB_SERVICE_TOKEN`, which the console reads platform-level data with as itself rather than as an operator: the tenants and their members and invitations, the platform settings and policies, the email and storage settings, the dashboard, the operators, and the end users, each cached once for every operator. The app refuses to start without it. See [Web service credential](../../server/README.md#web-service-credential)

### Request host

`lib/csrf.ts` compares a form submission's origin with the host the request was sent to (`getRequestHost` in [`@publira/utils/request-host`](../../packages/utils/README.md#subpaths)): the rightmost `host=` of `Forwarded`, then the rightmost value of `X-Forwarded-Host`, then `Host`.

- `PUBLIRA_FORWARDED_HEADER_ENABLED` — `false` skips `Forwarded`, for an edge that writes `X-Forwarded-Host` and passes on a `Forwarded` header the caller sent. `true` when unset. It takes the values Go's `strconv.ParseBool` reads, as `publira server` does: `true`, `false`, `1`, `0`, `t`, and `f`, in lower, upper, or title case. Anything else is refused. The same variable as on `publira server`, which reads it for the client address.

### Server cache (Redis)

`next.config.ts` wires `@publira/next-cache-handlers`, as web-storefront does.

- `PNCH_REDIS_URL` (the same value as the server's `PUBLIRA_REDIS_URL`)
- `PNCH_CACHE_APP=web-platform` (set by the `dev` and `start` scripts; it separates the key space)

### Internal cache revalidation

`POST /api/v1/revalidate` is the revalidation entry point reserved for the Go server. It checks `PUBLIRA_REVALIDATE_TOKEN`, the same value as the server's, against the `X-Revalidate-Token` header and calls `revalidateTag(tag, "max")` on the tags it receives (`@publira/utils/revalidate`), without restricting them by tenant ID. This path bypasses the setup check and the session authentication in `proxy.ts`. The destination is `PUBLIRA_WEB_PLATFORM_INTERNAL_URL` on the private network.

### Distributed tracing

`instrumentation.ts` calls `registerTracing("publira-web-platform")` from `@publira/tracing`, which emits Next.js inbound spans and client spans for the Connect RPCs made during SSR. It is off by default and only registers when `PUBLIRA_TRACING_ENABLED` is set. In the Dev Container, look for the `publira-web-platform` service in the Jaeger UI (`http://localhost:16686`).

For the environment variables and how `NEXT_OTEL_VERBOSE` is handled, see [`packages/tracing/README.md`](../../packages/tracing/README.md).

### Session cookie (JWE)

Required environment variables:

- `PUBLIRA_AUTH_SECRET` (32 bytes or more) — the key that seals the platform console's session cookie. There is no fallback: an unset or too short value raises. For the details and how to issue one, see [`@publira/web-session`](../../packages/web-session/README.md#environment-variables)

### Second factor (MFA)

A password that is accepted but still owes a second factor earns a short-lived challenge instead of a session. `/mfa` is the screen that spends it — a public path in `proxy.ts`, because it is reached without a session — and an operator manages their own factor from the Two-step verification card on `/account`.

| Part | Where it lives |
| --- | --- |
| The challenge and its `publira_web_platform_mfa` cookie | `lib/mfa-challenge.ts` |
| The session cookie both sign-in steps write | `lib/platform-session-cookie.ts` |
| The console's MFA RPCs | `lib/platform-mfa.ts` |
| The `verify` and `enroll` screens | `app/[locale]/mfa/` |
| The operator's own factor | `app/[locale]/(protected)/account/_components/mfa-settings-card.tsx` |
| The enrollment QR code | `components/mfa-enrollment-secret.tsx`, drawn by `@publira/ui-components/qr-code` |
