# web-admin

The console where publishers and editors enter and operate their content.

## Responsibilities

- Registering and editing Series / Episode
- Publication settings (including scheduled publication)
- Per-tenant brand settings (theme, logo, and so on)
- Per-tenant Stripe payment settings (registering, updating, and disabling the secret)
- Read-through reporting: how many members finished each episode, over the member views of the same period

## UI locale

- The UI locale is stored in the `publira_locale` cookie (`Path=/`, `SameSite=Lax`, `Max-Age` of one year, not `httpOnly`). It never appears in the URL. The same host shares one cookie across tenants
- The resolution order is cookie → the tenant's saved default locale, and there is no third step. An unsupported cookie value is treated as unset and falls through to the tenant default. An unauthenticated screen (login and friends) resolves the same value: it comes from the public `GetTenant`, which answers without a session
- Read it with `getLocale(tenantId)` from `lib/locale.ts`. It uses `cookies()`, so call it **only from inside a `<Suspense>` boundary**. Never call it inside `"use cache"`; pass the locale in as an argument instead. A tenant whose saved default cannot be read at all throws rather than naming a language: `lib/public-api.ts` answers from the last locale the API confirmed for that tenant, and only a process that has never had one gives up
- A Server Component reads the tenant id from `next/root-params`. A Server Action cannot, so it takes the tenant id from its own input (a form value)
- The tenant default locale is the default language card on `/settings`. `lib/tenant-default-locale.ts` reads it with `"use cache: private"` and calls `updateTag` on save
- `loadAdminMessages(locale)` dynamically `import()`s the repo-root [`locales/*.json`](../../locales/README.md)
- Copy reaches the screen through `<Message>` in `components/message.tsx`. The caller wraps each string in its own `<Suspense>` with a `Skeleton` fallback, so the wait on the locale and the catalog stays inside that component and the navigation and page frame remain in the static shell. The tenant id comes from the route segment, so an operator with no cookie still sees the tenant default locale
- Copy that goes into an attribute such as `aria-label` or `alt` cannot be streamed as a node. The place that assembles the value resolves the catalog itself — as `components/admin-brand-logo.tsx` and `components/notification-bell.tsx` do — and waits behind a `<Suspense>` of its own that covers only that one control
- `error.tsx` is a Client Component, so it cannot use `<Message>`. `<ClientMessage>` in `components/client-message.tsx` reads the cookies from `document.cookie` instead — `publira_locale`, then `publira_resolved_locale`, then `<html lang>`, and only a browser carrying none of them falls back to what it asked for. That boundary cannot reach the admin API, which is the point: it renders when the API holding the setting is down. Wrap it in a `<Suspense>` at the call site, just like `<Message>`: there is no boundary above an error boundary, so suspending without a fallback cuts the response off mid-body and the error screen itself never streams
- A prop that receives copy takes a `ReactNode`, not a catalog key. Which string waits behind which `<Suspense>` then shows up in the calling code. Do not add a helper that only assembles a `<Suspense>` and a `<Message>`; write it at the call site. `ErrorScreen` takes all four strings (its single caller is `(protected)/error.tsx`)
- A prop is for copy that names the caller. `SectionErrorBoundary` takes one `title` holding the section name; the recovery guidance, the retry button, and the error ID label read the same at every boundary, so they belong to the frame rather than the section and `components/section-error-boundary.tsx` resolves them from the catalog itself (the defaults of `@publira/ui-components` are Japanese, so leaving them unresolved puts Japanese on an English screen). Since `<Message>` is an async Server Component that component has to be a Server Component, so only the `catchError` call is split out into `components/section-error-catch.tsx` (`"use client"`)
- An individual operator switches locale from the display language card on `/settings`. The `setAdminLocaleAction` Server Action writes the cookie and the screen re-renders in the same round trip
- `proxy.ts` publishes the tenant's saved default as `publira_resolved_locale` on every response it resolves a tenant for, from the Host-to-tenant resolution it makes to route the request anyway (`@publira/utils/resolved-locale`). The paths that answer before that read — the health probes, `/logout`, and `/favicon.ico` — carry no cookie, and an unresolvable saved code expires the one an earlier answer left instead of leaving a stale language standing. It is the only way the browser learns that value, and both the `<head>` script and the client error boundary read it
- `<html lang>` is not rendered by `[tenant_id]/layout.tsx` at all: the layout stays synchronous and an inline `<head>` script applies the operator's cookie, then the published tenant default. For the reasoning and the constraints, see `LOCALE_LANG_SCRIPT` in `@publira/i18n`. `global-not-found.tsx` never passes through a layout and its body cannot follow the locale either, so it stays on `lang="ja"`

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

- A password that is accepted but still owes a second factor earns no session. `Login` answers with a short-lived challenge token instead, and the console holds it in the `publira_web_admin_mfa` cookie — sealed with the same `PUBLIRA_AUTH_SECRET`, `httpOnly`, and expiring with the challenge itself. It deliberately never travels in the URL, where a token would survive in history and in `Referer`
- `/mfa` is the screen that spends it, and it is a public path in `proxy.ts` because it is reached without a session. The challenge's `kind` decides what it shows: `verify` asks for a code from the authenticator app — or one of the recovery codes — and `enroll` runs the registration a tenant requires of an administrator before it will finish the login. Both end by writing the ordinary session cookie and clearing the challenge
- An administrator manages their own factor from the two-step verification card on `/settings/account`: registering an authenticator, replacing the recovery codes, and turning the factor off. Recovery codes exist in plaintext only in the response that issues them, so that card keeps a batch on screen after the status around it has changed
- A refused code and a rejected session both come back `unauthenticated`. The console separates them by the `MFA_INVALID_CODE` / `MFA_LOCKED` reason the API attaches as `google.rpc.ErrorInfo`; without it a mistyped digit would sign the operator out
- The enrollment QR code is turned into SVG path geometry on the server (`lib/qr-code.ts`, `uqr`), so what reaches the browser is one path string rather than a matrix or injected markup. Its colours are fixed black on white: a camera cannot read an inverted code, so it does not follow the tenant theme

### Distributed tracing

`instrumentation.ts` calls `registerTracing("publira-web-admin")` from `@publira/tracing`, which emits Next.js inbound spans and client spans for the Connect RPCs made during SSR. It is off by default and only registers when `PUBLIRA_TRACING_ENABLED` is set. In the Dev Container, look for the `publira-web-admin` service in the Jaeger UI (`http://localhost:16686`).

For the environment variables and how `NEXT_OTEL_VERBOSE` is handled, see [`packages/tracing/README.md`](../../packages/tracing/README.md).

### Image delivery (`next/image`)

`images.loader: "custom"` / `loaderFile: "./lib/image-loader.ts"` in `next.config.ts` let `next/image` use the Manael conversion of admin-image-server directly. The requested width is passed as `w` only when reading `/images/...`, and WebP / AVIF is decided by the browser's `Accept`. Leave an `<Image>` that does not go through admin-image-server — a temporary `blob:` preview, for instance — `unoptimized`. The loader's implementation and specification are in [`packages/utils/README.md`](../../packages/utils/README.md).
