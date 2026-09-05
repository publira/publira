# web-host

The public tenant site. It serves the delivery catalog, authentication, and the member pages as a single Next.js app.

## Development

```bash
cd apps/web-host
pnpm dev
```

The default port is `3000`.

### URLs and locales

A public URL carries no locale prefix in the tenant's default locale (`/series/SR01`) and a `/{locale}/...` prefix in any other locale (`/en/series/SR01`). `proxy.ts` resolves the tenant from the Host and rewrites the request onto the `app/[tenant_id]/[locale]/...` route tree; `proxy.test.ts` is the specification of what it rewrites, redirects, and refuses.

| Where the locale is read | How |
| --- | --- |
| Server Component | `getLocale()` in `lib/locale.ts` |
| Client Component | `useLocale()` in `components/locale-provider.tsx`, with the tenant's stored default beside it as `useTenantDefaultLocale()` |
| Server Action | An argument bound by the Server Component, or the `<LocaleField />` hidden field in `components/locale-field.tsx` |
| Server-side, the tenant's stored default | `getTenantDefaultLocale()` in `lib/tenant.ts` |
| The browser, where no provider is above the render | `readClientLocale()` in `lib/client-locale.ts` |

The tenant id travels the same way: `getTenantId()` in `lib/tenant-id.ts`, `useTenantId()` in `lib/use-tenant-id.ts`, and `<TenantIdField />` in `components/tenant-id-field.tsx`.

In-app links carry the prefix through `<LocaleLink>` in `components/locale-link.tsx`, or through `withLocalePrefix()` in `lib/locale-path.ts` where a bare href is handed to a shared component. The header's language switcher is `components/locale-switcher.tsx`.

### Screen copy

Reader-facing copy comes from `host.*` in the repo-root [`locales/{locale}.json`](../../locales/README.md). `loadHostMessages(locale)` in `lib/messages.ts` loads the catalog, `<Message>` in `components/message.tsx` renders one string on the server, and `<ClientMessage>` in `components/client-message.tsx` renders one in the browser. `getMessage()` is called directly where the value has to be a string — `aria-label`, `placeholder`, and `generateMetadata`'s `title`.

Series titles, synopses, episode bodies, and the contents of a published page are written by the tenant and are not translated. They stay as written whatever the locale. The stand-in label for a tenant with no name set comes from `getTenantSiteLabel(tenantId, locale)` in `lib/tenant.ts`.

### Session cookie (JWE)

Required environment variables:

- `PUBLIRA_AUTH_SECRET` (32 bytes or more) — the key that seals the `publira_web_host_auth` cookie. There is no fallback: an unset or too short value raises. For the details and how to issue one, see the [repository README](../../README.md#session-cookie-encryption-key-publira_auth_secret)

### Server cache (Redis)

`next.config.ts` wires `@publira/next-cache-handlers`.

- `cacheHandlers` (plural): `"use cache"` / `"use cache: remote"`
- `cacheHandler` (singular): ISR / Route Handler / `fetch` / `unstable_cache`

Environment variables:

- `PUBLIRA_REDIS_URL` (`redis://redis:6379` in the Dev Container)
- `PUBLIRA_CACHE_APP=web-host` (recommended; it separates the key space)

### Internal cache revalidation

`POST /api/v1/revalidate` is the revalidation entry point reserved for the Go server. It checks `PUBLIRA_REVALIDATE_TOKEN` against the `X-Revalidate-Token` header and revalidates the tags it receives (`@publira/next-cache-handlers/revalidate`), without restricting them by tenant ID. This path bypasses the Host-based tenant resolution in `proxy.ts`. The destination is `PUBLIRA_WEB_HOST_INTERNAL_URL` on the private network, and the tags themselves are built by `lib/cache-tags.ts`.

### Distributed tracing

`instrumentation.ts` calls `registerTracing("publira-web-host")` from `@publira/tracing`, which emits Next.js inbound spans and client spans for the Connect RPCs made during SSR. It is off by default and only registers when `PUBLIRA_TRACING_ENABLED` is set. In the Dev Container, look for the `publira-web-host` service in the Jaeger UI (`http://localhost:16686`).

For the environment variables and how `NEXT_OTEL_VERBOSE` is handled, see [`packages/tracing/README.md`](../../packages/tracing/README.md).

### `/theme.css`

The per-tenant stylesheet, served by `app/[tenant_id]/theme.css/route.ts` over the `getTenantTheme()` read in `lib/tenant.ts` and its own cache tag from `lib/cache-tags.ts`. The document shell links it, so every page picks up the tenant's colors.

### Image delivery (`next/image`)

`images.loader: "custom"` / `loaderFile: "./lib/image-loader.ts"` in `next.config.ts` point `next/image` at the Manael conversion of image-server. `lib/image-loader.ts` re-exports the shared loader; its specification is in [`packages/utils/README.md`](../../packages/utils/README.md). An `<Image>` whose source does not go through image-server — a temporary `blob:` preview, for instance — is `unoptimized`.

### Episode viewer (Canvas)

`@publira/comic-viewer` draws the episode body on a Canvas and owns fetching, decoding, and prefetching the pages. It emits no `<img>`. What this app supplies sits under `app/[tenant_id]/[locale]/(site)/series/[series_id]/episodes/[episode_id]/`:

| File | What it holds |
| --- | --- |
| `_lib/viewer-pages.ts` | The episode's body images as the viewer's page list |
| `_lib/viewer-fetch.ts` | The fetch plugin: the `Accept` the pages are requested with, and decrypting an `X-Publira-Image-Encryption` response in the browser |
| `_lib/viewer-layout.ts` | `VIEWER_HEIGHT_CLASS`, the height the reader and the body skeleton share |
| `_components/episode-comic-viewer.tsx` | The toolbar, the paging and full-screen controls, and the per-page reload |

Paging and full screen are the only on-screen controls; zooming and resetting are the library's own gestures.

Which read supplies the pages depends on the episode's access, and so does the token their URLs carry:

| Body | Read | `t` on its image URLs |
| --- | --- | --- |
| Free | `getEpisodeDetail()` in `lib/catalog.ts` — `"use cache"`, one entry shared by every reader, revalidated after 15 minutes and expiring after an hour | A media token naming no reader: the same bytes for every reader of that episode until it rotates the next day |
| Entitled | `getEpisodeViewer()` in `lib/catalog.ts` — `"use cache: private"`, one entry per reader | A media token naming that reader |

`_lib/viewer-fetch.ts` derives the decryption key from that token and its subject, the same way for both, and decrypting a free body therefore needs no session. A page whose stream cannot be reversed fails on its own and keeps the reader's reload control; the rest of the body still draws.

image-server encrypts every body it serves, free and entitled alike. A page that still arrives as an ordinary image is passed through untouched, which is what answers a reader a rolling deploy is still routing to an instance it has not replaced yet. What each body is bound to on the server side, and the `Cache-Control` it keeps, is in the [server README](../../server/README.md#image-delivery-manael).

`e2e/tests/host.viewer-performance.spec.ts` holds the drawing budget — time to the first page, the response and the drawn page of a page turn, and a cumulative layout shift of zero — against a seeded episode served through image-server. The numbers, what each one covers, and how to measure them again are in [`e2e/README.md`](../../e2e/README.md).

### Brand images

`link rel="icon"` and `link rel="apple-touch-icon"` are resolved by `lib/tenant-icon.ts`, and the header's brand mark by `lib/tenant-logo.ts`. Both read the tenant's branding variants from `getTenantSiteInfo()`, and image-server delivers them (`/images/tenants/{media_id}/icon`, `/images/tenants/{media_id}/logo`).

### Episode purchase

The checkout button on a paid episode leads to Stripe Checkout. After the reader comes back from Stripe, the purchase recorded by the `checkout.session.completed` webhook grants access to the body images. web-host itself holds no Stripe secret key. The return URL and the webhook are received on the tenant's public domain; for the procedure, see the [server README](../../server/README.md#stripe-checkout-episode-purchases).

## What it covers

- Public pages (privacy policy, terms of service, and so on)
- Catalog (series, episodes, creators, labels)
- Authentication (sign in, sign up, password reset)
- Member area (my page, announcements, settings)
