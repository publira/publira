# web-platform

The cross-tenant operations console for platform operators. Its responsibilities are kept separate from web-admin, which covers operations inside a single tenant.

## Information architecture

### Routes

| Route | Screen | Purpose | Authentication |
| --- | --- | --- | --- |
| `/login` | Login | Entry point for a platform operator | Not required |
| `/` | Dashboard | Cross-tenant KPIs and recent events | Required |
| `/tenants` | Tenant list | Cross-tenant status list | Required |
| `/tenants/new` | Tenant creation | Issue a new tenant | Required |
| `/tenants/[tenant_id]` | Tenant detail | Status and contract information of one tenant | Required |
| `/operators` | Operator management | Operator role management | Required |
| `/audit-logs` | Audit logs | Trace the change history | Required |

### Authentication and authorization

- `proxy.ts` protects every path that is not in `PUBLIC_PATHS` (`/login`, `/livez`, `/readyz`, `/confirm-email`, `/confirm-password`, `/reset-password`, `/reset-password/requested`, `/setup`)
- There is no `/logout` route. Signing out goes through the header's Server Action only
- Session cookie: `publira_web_platform_auth`
- Initial role definitions: `platform_owner`, `platform_operator`, `platform_auditor`
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
| The saved platform default | `lib/platform-settings.ts`, behind the Default language card on `/settings/general` |
| The locale a screen with nothing saved yet opens on | `getInitialLocaleCandidate()` in `lib/initial-locale.ts`, over the request's `Accept-Language` |
| The catalog | `loadPlatformMessages(locale)` in `lib/messages.ts`, over the repo-root [`locales/*.json`](../../locales/README.md); this app's copy is the `platform.*` namespace |
| One string on the server | `<Message>` in `components/message.tsx`, and `SetupMessage` in `app/setup/_components/` for `/setup` |
| One string in the browser | `<ClientMessage>` in `components/client-message.tsx`, for `app/error.tsx` |
| `<html lang>` | The inline `<head>` script in `app/layout.tsx` (`LOCALE_LANG_SCRIPT` in `@publira/i18n`) |
| The default the browser learns from | The `publira_resolved_locale` cookie `proxy.ts` publishes (`@publira/utils/resolved-locale`) |

An operator switches locale from the Display language card on `/settings/general`, through the `setPlatformLocaleAction` Server Action in `lib/locale-action.ts`.

A new tenant's default language is not taken from the platform default: `/tenants/new` carries its own selector (`_components/tenant-default-locale-select.tsx`), and `/setup` saves the platform's first one from the selector on that screen.

### Split of responsibilities with web-admin

- web-platform: cross-tenant operations
  - Tenant creation and status management
  - Operator management
  - Audit log review
- web-admin: operations inside a tenant
  - Series / Episode entry
  - Publication settings
  - Brand settings within a tenant

## Development

```bash
cd apps/web-platform
pnpm dev
```

### Internal cache revalidation

`POST /api/v1/revalidate` is the revalidation entry point reserved for the Go server. It checks `PUBLIRA_REVALIDATE_TOKEN` against the `X-Revalidate-Token` header and calls `revalidateTag(tag, "max")` on the tags it receives, without restricting them by tenant ID. This path bypasses the setup check and the session authentication in `proxy.ts`. The destination is `PUBLIRA_WEB_PLATFORM_INTERNAL_URL` on the private network.

### Distributed tracing

`instrumentation.ts` calls `registerTracing("publira-web-platform")` from `@publira/tracing`, which emits Next.js inbound spans and client spans for the Connect RPCs made during SSR. It is off by default and only registers when `PUBLIRA_TRACING_ENABLED` is set. In the Dev Container, look for the `publira-web-platform` service in the Jaeger UI (`http://localhost:16686`).

For the environment variables and how `NEXT_OTEL_VERBOSE` is handled, see [`packages/tracing/README.md`](../../packages/tracing/README.md).

### Session cookie (JWE)

Required environment variables:

- `PUBLIRA_AUTH_SECRET` (32 bytes or more) — the key that seals the platform console's session cookie. There is no fallback: an unset or too short value raises. For the details and how to issue one, see the [repository README](../../README.md#session-cookie-encryption-key-publira_auth_secret)
