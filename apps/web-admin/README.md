# web-admin

The console where publishers and editors enter and operate their content.

## Responsibilities

- Registering and editing Series / Episode
- Publication settings (including scheduled publication)
- Per-tenant brand settings (theme, logo, and so on)
- Per-tenant Stripe payment settings (registering, updating, and disabling the secret)
- Read-through reporting: how many members finished each episode, over the member views of the same period

## UI locale

The locale is never in the URL. It lives in the `publira_locale` cookie, and resolves cookie → the tenant's stored default locale.

| Part | Where it lives |
| --- | --- |
| The resolved locale | `getLocale(tenantId)` in `lib/locale.ts`, and the cookie options the switcher writes with |
| The tenant's stored default, without a session | `getTenantDisplayLocale()` in `lib/public-api.ts`, over the public `GetTenant` |
| The tenant's stored default, as a setting to read and save | `lib/tenant-default-locale.ts`, behind the Default language card on `/settings` |
| The catalog | `loadAdminMessages(locale)` in `lib/messages.ts`, over the repo-root [`locales/*.json`](../../locales/README.md) |
| One string on the server | `<Message>` in `components/message.tsx` |
| One string in the browser | `<ClientMessage>` in `components/client-message.tsx`, for `error.tsx` |
| `<html lang>` | The inline `<head>` script in `app/[tenant_id]/layout.tsx` (`LOCALE_LANG_SCRIPT` in `@publira/i18n`) |
| The default the browser learns from | The `publira_resolved_locale` cookie `proxy.ts` publishes (`@publira/utils/resolved-locale`) |

An individual operator switches locale from the Display language card on `/settings`, through the `setAdminLocaleAction` Server Action in `lib/locale-action.ts`.

## Development

```bash
cd apps/web-admin
pnpm dev
```

### Internal cache revalidation

`POST /api/v1/revalidate` is the revalidation entry point reserved for the Go server. It checks `PUBLIRA_REVALIDATE_TOKEN` against the `X-Revalidate-Token` header and calls `revalidateTag(tag, "max")` on the tags it receives, without restricting them by tenant ID. This path bypasses the Host-based tenant resolution in `proxy.ts` and the session authentication. The destination is `PUBLIRA_WEB_ADMIN_INTERNAL_URL` on the private network.

### Session cookie (JWE)

Required environment variables:

- `PUBLIRA_AUTH_SECRET` (32 bytes or more) — the key that seals the console's session cookie. There is no fallback: an unset or too short value raises. For the details and how to issue one, see the [repository README](../../README.md#session-cookie-encryption-key-publira_auth_secret)

### Second factor (MFA)

A password that is accepted but still owes a second factor earns a short-lived challenge instead of a session. `/mfa` is the screen that spends it — a public path in `proxy.ts`, because it is reached without a session — and an administrator manages their own factor from the Two-step verification card on `/settings/account`.

| Part | Where it lives |
| --- | --- |
| The challenge and its `publira_web_admin_mfa` cookie | `lib/mfa-challenge.ts` |
| The console's MFA RPCs | `lib/admin-mfa.ts` |
| The `verify` and `enroll` screens | `app/[tenant_id]/mfa/` |
| The operator's own factor | `app/[tenant_id]/(protected)/settings/_components/mfa-settings-card.tsx` |
| The enrollment QR code | `lib/qr-code.ts` (`uqr`) and `components/qr-code.tsx` |

### Distributed tracing

`instrumentation.ts` calls `registerTracing("publira-web-admin")` from `@publira/tracing`, which emits Next.js inbound spans and client spans for the Connect RPCs made during SSR. It is off by default and only registers when `PUBLIRA_TRACING_ENABLED` is set. In the Dev Container, look for the `publira-web-admin` service in the Jaeger UI (`http://localhost:16686`).

For the environment variables and how `NEXT_OTEL_VERBOSE` is handled, see [`packages/tracing/README.md`](../../packages/tracing/README.md).

### Image delivery (`next/image`)

`images.loader: "custom"` / `loaderFile: "./lib/image-loader.ts"` in `next.config.ts` point `next/image` at the Manael conversion of admin-image-server. `lib/image-loader.ts` re-exports the shared loader; its specification is in [`packages/utils/README.md`](../../packages/utils/README.md). An `<Image>` whose source does not go through admin-image-server — a temporary `blob:` preview, for instance — is `unoptimized`.
