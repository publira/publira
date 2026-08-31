# web-admin

The console where publishers and editors enter and operate their content.

## Responsibilities

- Registering and editing Series / Episode
- Publication settings (including scheduled publication)
- Per-tenant brand settings (theme, logo, and so on)
- Per-tenant Stripe payment settings (registering, updating, and disabling the secret)

## UI locale

- The UI locale is stored in the `publira_locale` cookie (`Path=/`, `SameSite=Lax`, `Max-Age` of one year, not `httpOnly`). It never appears in the URL. The same host shares one cookie across tenants
- The resolution order is cookie → tenant default locale → `ja`. An unsupported cookie value is treated as unset and falls through to the tenant default locale. An unauthenticated screen (login and friends) cannot call the admin API, so it stays on the cookie value or `ja`
- Read it with `getLocale(tenantId?)` from `lib/locale.ts`. It uses `cookies()`, so call it **only from inside a `<Suspense>` boundary**. Never call it inside `"use cache"`; pass the locale in as an argument instead. The fallback to the tenant default locale happens only when `tenantId` is passed, and even then it lands on `ja` without a session
- A Server Component reads the tenant id from `next/root-params`. A Server Action cannot, so it takes the tenant id from its own input (a form value)
- The tenant default locale is the 既定言語 card on `/settings`. `lib/tenant-default-locale.ts` reads it with `"use cache: private"` and calls `updateTag` on save
- `loadAdminMessages(locale)` dynamically `import()`s the repo-root [`locales/*.json`](../../locales/README.md)
- Copy reaches the screen through `<Message>` in `components/message.tsx`. The caller wraps each string in its own `<Suspense>` with a `Skeleton` fallback, so the wait on the locale and the catalog stays inside that component and the navigation and page frame remain in the static shell. The tenant id comes from the route segment, so an operator with no cookie still sees the tenant default locale
- Copy that goes into an attribute such as `aria-label` or `alt` cannot be streamed as a node. The place that assembles the value resolves the catalog itself — as `components/admin-brand-logo.tsx` and `components/notification-bell.tsx` do — and waits behind a `<Suspense>` of its own that covers only that one control
- `error.tsx` is a Client Component, so it cannot use `<Message>`. `<ClientMessage>` in `components/client-message.tsx` reads the cookie from `document.cookie` instead. That boundary cannot reach the admin API, so with no cookie it falls back to `ja` rather than the tenant default locale. Wrap it in a `<Suspense>` at the call site, just like `<Message>`: there is no boundary above an error boundary, so suspending without a fallback cuts the response off mid-body and the error screen itself never streams
- A prop that receives copy takes a `ReactNode`, not a catalog key. Which string waits behind which `<Suspense>` then shows up in the calling code. Do not add a helper that only assembles a `<Suspense>` and a `<Message>`; write it at the call site. `ErrorScreen` takes all four strings (its single caller is `(protected)/error.tsx`)
- A prop is for copy that names the caller. `SectionErrorBoundary` takes one `title` holding the section name; the recovery guidance, the retry button, and the error ID label read the same at every boundary, so they belong to the frame rather than the section and `components/section-error-boundary.tsx` resolves them from the catalog itself (the defaults of `@publira/ui-components` are Japanese, so leaving them unresolved puts Japanese on an English screen). Since `<Message>` is an async Server Component that component has to be a Server Component, so only the `catchError` call is split out into `components/section-error-catch.tsx` (`"use client"`)
- An individual operator switches locale from the 表示言語 card on `/settings`. The `setAdminLocaleAction` Server Action writes the cookie and the screen re-renders in the same round trip
- `<html lang>` is resolved by the static attribute in `[tenant_id]/layout.tsx` plus an inline script in `<head>`. For the reasoning and the constraints, see `LOCALE_LANG_SCRIPT` in `packages/utils/README.md`. `global-not-found.tsx` never passes through a layout and its body cannot follow the locale either, so it stays on `lang="ja"`

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

### Distributed tracing

`instrumentation.ts` calls `registerTracing("publira-web-admin")` from `@publira/tracing`, which emits Next.js inbound spans and client spans for the Connect RPCs made during SSR. It is off by default and only registers when `PUBLIRA_TRACING_ENABLED` is set. In the Dev Container, look for the `publira-web-admin` service in the Jaeger UI (`http://localhost:16686`).

For the environment variables and how `NEXT_OTEL_VERBOSE` is handled, see [`packages/tracing/README.md`](../../packages/tracing/README.md).

### Image delivery (`next/image`)

`images.loader: "custom"` / `loaderFile: "./lib/image-loader.ts"` in `next.config.ts` let `next/image` use the Manael conversion of admin-image-server directly. The requested width is passed as `w` only when reading `/images/...`, and WebP / AVIF is decided by the browser's `Accept`. Leave an `<Image>` that does not go through admin-image-server — a temporary `blob:` preview, for instance — `unoptimized`. The loader's implementation and specification are in [`packages/utils/README.md`](../../packages/utils/README.md).
