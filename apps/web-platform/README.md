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
- `/logout` has been removed. Both GET and POST return 404 and leave the session cookie untouched. Signing out goes through the header's Server Action only
- Session cookie: `publira_web_platform_auth`
- Initial role definitions: `platform_owner`, `platform_operator`, `platform_auditor`
- Screens are guarded in `(protected)/layout.tsx`

### Shared layout (app shell)

- Left: sidebar (main navigation plus a note on the responsibility split)
- Top: header (the current operator plus the main actions)
- Body: `PlatformPage` gives every page the same page header and content container
- Mobile: the sidebar is reused as a drawer

### UI locale

- The UI locale is stored in the `publira_locale` cookie (`Path=/`, `SameSite=Lax`, `Max-Age` of one year, not `httpOnly`). It never appears in the URL
- The resolution order is cookie → platform default locale → `ja`. A supported cookie value always wins; only an unset or unknown value falls through to the default locale. When the default locale itself cannot be read — including on a screen without a session, such as login — it is `ja`
- `/setup` is the exception: it runs before the first operator exists, so there is no cookie and no settings row to read. It negotiates the request's `Accept-Language` against the supported locales with `getInitialLocaleCandidate()` from `lib/initial-locale.ts`, falling back to `en` when the header names none of them, and renders its copy through `SetupMessage` rather than `<Message>`
- Read it with `getPlatformLocale()` from `lib/locale.ts`. It uses `cookies()`, so call it **only from inside a `<Suspense>` boundary**. Never call it inside `"use cache"`; pass the locale in as an argument instead
- `loadPlatformMessages(locale)` dynamically `import()`s the repo-root [`locales/*.json`](../../locales/README.md). This app's copy lives in the `platform.*` namespace
- Copy is rendered one string at a time with `<Message message="platform.auth.login.submit" />` from `components/message.tsx`, wrapped in a `<Suspense>` whose fallback is a `SkeletonLine` sized to that string. The card and the inputs around it stay in the static shell
- A section that branches on an RPC result or on `searchParams` — the `/setup` gate, the `/confirm-email` outcome, and so on — decides only which `PlatformMessageKey` to use and still renders it through `<Message>`. Never pass the catalog (`messages`) down to a child as a prop
- Pass rendered nodes to a Client Component through a `copy` prop (`LoginFormCopy` and friends), never the catalog. An `import()` of a catalog from the client ships both locales to the browser
- An attribute such as `placeholder` cannot be a node, so the control that carries one waits for the catalog itself. Wrap that single control in a `<Suspense>` whose fallback is a `Skeleton` of its height (`NameInput` on `/setup`)
- `getMessage` is used directly only for values that cannot be nodes: `generateMetadata`'s `title`, and anything on the Server Action side
- A zod schema carrying user-facing messages is a function of the catalog, not a module constant (`emailFormSchema(messages)` in `lib/auth-input.ts`). The copy depends on the request's locale, so it can only be resolved in a Server Action or inside a `<Suspense>`
- A `Suspense` fallback is part of the static shell and cannot follow the locale. Never write a sentence into one; render a `Skeleton` sized to the string it stands in for
- A prop is for copy that names the caller. `SectionErrorBoundary` takes one `title` holding the section name; the recovery guidance, the retry button, and the error ID label read the same at every boundary, so they belong to the frame rather than the section and `components/section-error-boundary.tsx` resolves them from the catalog itself (the defaults of `@publira/ui-components` are Japanese, so leaving them unresolved puts Japanese on an English screen). Since `<Message>` is an async Server Component that component has to be a Server Component, so only the `catchError` call is split out into `components/section-error-catch.tsx` (`"use client"`). `ErrorScreen` takes all four strings (its callers are `app/error.tsx` and `(protected)/error.tsx`, and neither duplicates the other)
- Switching happens on the display language card on `/settings/general`. The `setPlatformLocaleAction` Server Action writes the cookie and the screen re-renders in the same round trip
- The platform default locale is the default language card on the same screen (`getPlatformSettings` / `updatePlatformDefaultLocale` in `lib/platform-settings.ts`). Setup saves the first one from the language selector on `/setup`. On save the Server Action calls `updateTag` on `platform:settings`, so even a cookie-less view in the same session picks it up immediately
- A new tenant's default language is not taken from that setting: `/tenants/new` carries its own selector, seeded from `Accept-Language` the same way `/setup` is, and the Server Action sends the submitted locale to `CreateTenant`
- `<html lang>` is resolved by the static attribute in the root layout plus an inline script in `<head>`. For the reasoning and the constraints, see `LOCALE_LANG_SCRIPT` in `packages/utils/README.md`. `global-not-found.tsx` never passes through a layout and its body cannot follow the locale either, so it stays on `lang="ja"`

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
