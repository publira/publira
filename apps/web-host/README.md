# web-host

The public tenant site. It serves the delivery catalog, authentication, and the member pages as a single Next.js app.

## Development

```bash
cd apps/web-host
pnpm dev
```

The default port is `3000`.

### URLs and locales

A public URL carries no locale prefix in the tenant's default locale (`/series/SR01`) and a `/{locale}/...` prefix in any other locale (`/en/series/SR01`). `proxy.ts` resolves the tenant from the Host and internally rewrites an unprefixed URL to `/{tenantId}/{locale}{path}` using that tenant's default locale. A URL that spells the default locale out is redirected with a 307 to the canonical unprefixed URL, keeping the path and the query. `GetTenantByDomain` returns the default locale in the same response as the tenant id, so the decision costs no extra round trip.

- `/theme.css` and the Route Handlers (`/api/*`) live outside the locale. A Route Handler cannot read `next/root-params`
- The slug of a published page is matched against the path with the locale stripped off, so a slug such as `/{locale}/ja` still resolves as a public page
- A Server Component takes the locale from `getLocale()` in `lib/locale.ts`, a Client Component from `useLocale()` in `components/locale-provider.tsx`, and a Server Action from an argument or from the hidden field of `<LocaleField />`. The tenant id travels the same way, and a form that stays in the static shell carries `<TenantIdField />` from `components/tenant-id-field.tsx`
- The language switcher in the header is a link that replaces only the locale in the path. It does not carry the query string over
- When the server side needs the tenant's default locale, use `getTenantDefaultLocale()` from `lib/tenant.ts`. It is a thin entry point that returns `defaultLocale` from `getTenantSiteInfo()`, and falls back to `ja` when the tenant cannot be read. `proxy.ts` does not go through it (it runs before rendering, where `"use cache"` is unavailable, so it takes the value straight from the `GetTenantByDomain` response)

### Screen copy

Reader-facing copy comes from `host.*` in the repo-root `locales/{locale}.json`. `loadHostMessages(locale)` in `lib/messages.ts` loads the catalog, and a Server Component resolves one string at a time with `<Message message="host.…" />` wrapped in a `<Suspense>` with a `Skeleton`. `getMessage()` is called directly only where the value has to be a string — `aria-label`, `placeholder`, and `generateMetadata`'s `title`.

- Never read the locale inside `"use cache"`. A read such as `lib/catalog.ts` takes `locale` as an argument and includes the failure copy in the cache key
- A section that already blocks — a form reading `searchParams`, a list that branches on an RPC result — calls `getMessage()` inside that section instead of placing a `<Suspense>` per string. A boundary around copy that never reaches the static shell does not shorten the wait
- Pass a Client Component the resolved string (a `copy` prop) or a node, never the catalog. `error.tsx` is the exception: `<ClientMessage>` from `components/client-message.tsx` looks the copy up from the browser
- Series titles, synopses, episode bodies, and the contents of a published page are written by the tenant and are not translated. They stay as written whatever the locale
- The stand-in label for a tenant with no name set comes from `getTenantSiteLabel(tenantId, locale)` in `lib/tenant.ts`

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

The `revalidateTag` performed on publication (the internal-only `POST /api/v1/revalidate`) is consistent with the tag timestamps in Redis. `PUBLIRA_REVALIDATE_TOKEN` authenticates the shared token, and this path does not go through the Host-based tenant resolution in `proxy.ts`. Tags are revalidated as given, without restricting them by tenant ID, and the Go server reaches this app directly over `PUBLIRA_WEB_HOST_INTERNAL_URL`.

### Distributed tracing

`instrumentation.ts` calls `registerTracing("publira-web-host")` from `@publira/tracing`, which emits Next.js inbound spans and client spans for the Connect RPCs made during SSR. It is off by default and only registers when `PUBLIRA_TRACING_ENABLED` is set. In the Dev Container, look for the `publira-web-host` service in the Jaeger UI (`http://localhost:16686`).

For the environment variables and how `NEXT_OTEL_VERBOSE` is handled, see [`packages/tracing/README.md`](../../packages/tracing/README.md).

### Checking a theme CSS update

`/theme.css` is a dedicated `"use cache"` read tagged `tenant:{id}:theme`. The admin API revalidates that tag when a theme is saved, so a theme update on the public site does not depend on the cache tag of the site chrome. When an icon or a logo is updated, revalidate both the theme tag and `tenant:{id}:site`.

To check it by hand, save a theme color and then request `GET /theme.css` on the public domain. An existing browser or shared cache may keep serving the old response for the short TTL in `Cache-Control` (`max-age=30`, `s-maxage=30`, `stale-while-revalidate=60`), so disable the cache in DevTools or reload after the TTL has passed. Confirm that `--publira-color-primary` and the other values in the response changed to the color you saved. A failed revalidation is recorded in the admin API's `failed to request next revalidate after theme upsert` log, together with the tenant ID, the domain, and the tag.

### Image delivery (`next/image`)

`images.loader: "custom"` / `loaderFile: "./lib/image-loader.ts"` in `next.config.ts` let `next/image` use the Manael conversion of image-server directly. The requested width is passed as `w` only when reading `/images/...`, and WebP / AVIF is decided by the browser's `Accept`. Leave an `<Image>` that does not go through image-server — a temporary `blob:` preview, for instance — `unoptimized`. The loader's implementation and specification are in [`packages/utils/README.md`](../../packages/utils/README.md).

### Episode viewer (Canvas)

`@publira/comic-viewer` draws the episode body on a Canvas. It emits no `<img>`, so a body image can be saved by neither dragging nor a right click. Fetching, decoding, and prefetching pages are all owned by that library's pipeline.

- Body images do not go through `next/image`. The delivery URL of image-server (with its media token) is passed straight to the page's `src`
- Pages are fetched by a viewer plugin (`_lib/viewer-fetch.ts`), which adds `Accept`. The viewer fetches pages with `fetch()`, where `Accept` is not applied by default, and Manael neither converts nor resizes without it — so without the plugin the original full-size image comes down every time
- A response carrying `X-Publira-Image-Encryption: xor-hmac-sha256-v1` is decrypted in the browser by rebuilding the same stream from the short-lived media JWT in the URL (`t`), its `sub`, and `X-Publira-Image-Key-Id`. The MIME type after decryption comes from `X-Publira-Image-Content-Type`, and the result is handed only to the Canvas pipeline of `@publira/comic-viewer`. An unencrypted public image is still drawn as it is
- The only on-screen controls are paging and full screen. Both live on the viewer's own toolbar and hide themselves once the reader stops interacting. Zooming is a pinch and resetting is a one-finger double tap; both are gestures of the library
- The binding direction is the library's default, right to left. Spreads set `spreadStartIndex` to `1`, so the cover is shown on its own and pages 2 and 3 onward are paired
- A page that fails to load shows a reload control inside the viewer and retries that page alone. The episode as a whole is not dropped
- The viewer's height is owned by `VIEWER_HEIGHT_CLASS` in `_lib/viewer-layout.ts`, and the body skeleton reserves the same box. The episode information below it does not move after the first paint

### Site icon (`rel="icon"` / apple-touch-icon)

`link rel="icon"` and `link rel="apple-touch-icon"` point at the delivery URL of the tenant icon (`/images/tenants/{media_id}/icon`) when one is set. image-server delivers the image, and shaping it into a square PNG is already done on the server at upload time, so web-host performs no conversion. A tenant with no icon set declares none and leaves it to the browser's default.

### Site logo (header)

When a tenant logo is set, the brand area of the public site header shows its delivery URL (`/images/tenants/{media_id}/logo`). An unset logo, an empty URL, and a failed load all fall back to the existing site name text.

### Episode purchase

The checkout button on a paid episode leads to Stripe Checkout. After the reader comes back from Stripe, the purchase recorded by the `checkout.session.completed` webhook grants access to the body images. web-host itself holds no Stripe secret key. The return URL and the webhook are received on the tenant's public domain; for the procedure, see the [server README](../../server/README.md#stripe-checkoutエピソード購入).

## What it covers

- Public pages (privacy policy, terms of service, and so on)
- Catalog (series, episodes, creators, labels)
- Authentication (sign in, sign up, password reset)
- Member area (my page, announcements, settings)
