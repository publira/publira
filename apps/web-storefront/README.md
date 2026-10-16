# web-storefront

The public tenant site. It serves the delivery catalog, authentication, and the member pages as a single Next.js app.

## Development

```bash
pnpm dev --filter @publira/web-storefront
```

The default port is `3000`.

### URLs and locales

A public URL carries no locale prefix in the tenant's default locale (`/series/SR01`) and a `/{locale}/...` prefix in any other locale the tenant offers (`/en/series/SR01`). A prefix naming a locale the tenant does not offer redirects to the unprefixed URL. `proxy.ts` resolves the tenant from the Host and rewrites the request onto the `app/[tenant_id]/[locale]/...` route tree; `proxy.test.ts` is the specification of what it rewrites, redirects, and refuses.

| Where the locale is read | How |
| --- | --- |
| Server Component | `getLocale()` in `lib/locale.ts` |
| Client Component | `useLocale()` in `components/locale-context.tsx`, with the tenant's stored default beside it as `useTenantDefaultLocale()` and the locales it offers as `useTenantSupportedLocales()` |
| Server Action | An argument bound by the Server Component, or the `<LocaleField />` hidden field in `components/locale-field.tsx` |
| Server-side, the tenant's stored default | `getTenantDefaultLocale()` in `lib/tenant.ts` |
| Server-side, the locales the tenant offers | `getTenantSupportedLocales()` in `lib/tenant.ts` |
| The document element (`<html lang>`) | `PATH_LOCALE_LANG_SCRIPT` from `@publira/i18n` on a document load, then `<DocumentLocale>` in `components/document-locale.tsx` across client-side navigations |

The tenant id travels the same way: `getTenantId()` in `lib/tenant-id.ts`, `useTenantId()` in `lib/use-tenant-id.ts`, and `<TenantIdField />` in `components/tenant-id-field.tsx`.

In-app links carry the prefix through `<LocaleLink>` in `components/locale-link.tsx`, or through `withLocalePrefix()` in `lib/locale-path.ts` where a bare href is handed to a shared component. The header's language switcher is `components/locale-switcher.tsx`.

### Screen copy

Reader-facing copy comes from `storefront.*` in the repo-root [`locales/{locale}.json`](../../locales/README.md). `loadStorefrontMessages(locale)` in `lib/messages.ts` loads the catalog, `<Message>` in `components/message.tsx` renders one string on the server, and `<ClientMessage>` / `useClientMessages()` in `components/client-message.tsx` render one in a Client Component, from the `storefront` namespace `<StorefrontMessagesProvider>` in `components/storefront-messages-provider.tsx` carries. The root layout places that provider, so every route and both error boundaries read from it. A value that has to be a string — `aria-label`, `placeholder`, `generateMetadata`'s `title` — comes from an accessor bound to the locale rather than from the catalog: `getMessages()` in `lib/get-messages.ts` resolves the request's locale and answers one, and `getMessagesFor(locale)` in `lib/messages.ts` answers the same for a caller that already holds a locale.

Series titles, synopses, episode bodies, and the contents of a published page are written by the tenant and are not translated. They stay as written whatever the locale. The stand-in label for a tenant with no name set comes from `getTenantSiteLabel(tenantId, locale)` in `lib/tenant.ts`.

### API connection

- `PUBLIRA_GRPC_URL` — the `/rpc` base URL on `publira server`, which every server-side RPC is made on (`http://localhost:8000/rpc` when unset)

### Request host

`proxy.ts` resolves the tenant from the host the request was sent to, and `lib/csrf.ts` compares a form submission's origin with the same host (`getRequestHost` in [`@publira/utils/request-host`](../../packages/utils/README.md#subpaths)): the rightmost `host=` of `Forwarded`, then the rightmost value of `X-Forwarded-Host`, then `Host`.

- `PUBLIRA_FORWARDED_HEADER_ENABLED` — `false` skips `Forwarded`, for an edge that writes `X-Forwarded-Host` and passes on a `Forwarded` header the caller sent. `true` when unset. It takes the values Go's `strconv.ParseBool` reads, as `publira server` does: `true`, `false`, `1`, `0`, `t`, and `f`, in lower, upper, or title case. Anything else is refused. The same variable as on `publira server`, which reads it for the client address.

### Absolute tenant URLs

Canonical links, language alternates, the Open Graph URL, and the share URL come from the tenant's stored domain (`getTenantPublicOrigin` in `lib/tenant.ts`).

- `PUBLIRA_TENANT_URL_SCHEME` — `http` or `https`. `https` when unset. Anything else is refused.

### Session cookie (JWE)

Required environment variables:

- `PUBLIRA_AUTH_SECRET` (32 bytes or more) — the key that seals the `publira_web_storefront_auth` cookie. There is no fallback: an unset or too short value raises. For the details and how to issue one, see the [repository README](../../README.md#session-cookie-encryption-key-publira_auth_secret)

### Server cache (Redis)

`next.config.ts` wires `@publira/next-cache-handlers`.

- `cacheHandlers` (plural): `"use cache"` / `"use cache: remote"`
- `cacheHandler` (singular): ISR / Route Handler / `fetch` / `unstable_cache`

Environment variables:

- `PNCH_REDIS_URL` (`redis://redis:6379` in the Dev Container, the same value as the server's `PUBLIRA_REDIS_URL`)
- `PNCH_CACHE_APP=web-storefront` (set by the `dev` and `start` scripts; it separates the key space)

The rest are in the [package README](https://www.npmjs.com/package/@publira/next-cache-handlers).

### Internal cache revalidation

`POST /api/v1/revalidate` is the revalidation entry point reserved for the Go server. It checks `PNCH_REVALIDATE_TOKEN`, set to the server's `PUBLIRA_REVALIDATE_TOKEN`, against the `X-Revalidate-Token` header and revalidates the tags it receives (`@publira/next-cache-handlers/revalidate`), without restricting them by tenant ID. This path bypasses the Host-based tenant resolution in `proxy.ts`. The destination is `PUBLIRA_WEB_STOREFRONT_INTERNAL_URL` on the private network, and the tags themselves are built by `lib/cache-tags.ts`.

### Distributed tracing

`instrumentation.ts` calls `registerTracing("publira-web-storefront")` from `@publira/tracing`, which emits Next.js inbound spans and client spans for the Connect RPCs made during SSR. It is off by default and only registers when `PUBLIRA_TRACING_ENABLED` is set. In the Dev Container, look for the `publira-web-storefront` service in the Jaeger UI (`http://localhost:16686`).

For the environment variables and how `NEXT_OTEL_VERBOSE` is handled, see [`packages/tracing/README.md`](../../packages/tracing/README.md).

### `/theme.css`

The per-tenant stylesheet, served by `app/[tenant_id]/theme.css/route.ts` over the `getTenantTheme()` read in `lib/tenant.ts` and its own cache tag from `lib/cache-tags.ts`. The document shell links it, so every page picks up the tenant's colors.

### `/.well-known/assetlinks.json` and `/.well-known/apple-app-site-association`

The documents that let the tenant's Android and iOS apps open its links, built in `lib/mobile-app-association.ts` from the identities saved in the tenant console and served as `application/json` by the Route Handlers under `app/[tenant_id]/.well-known/`. A platform the tenant has no app on answers 404, and an unavailable API answers 503.

### `/.well-known/change-password`

The [change-password URL](https://www.w3.org/TR/change-password-url/) a password manager opens for the site, served by `app/[tenant_id]/.well-known/change-password/route.ts` as a `302` to `/settings/security` on the same host.

### `/robots.txt`, `/sitemap.xml`, and `/sitemap/{n}.xml`

The documents a crawler reads. `robots.txt` (`lib/robots.ts`) opens the catalogue, disallows `/api/` and the reader-only paths in `lib/reader-paths.ts`, and names the sitemap. A published page that takes a reader-only path's place is allowed again. The sitemap (`lib/sitemap.ts`) lists every page `ListSitemapEntries` returns once in each locale the tenant offers, each `<url>` naming every such locale as an alternate. It is one file while it fits the protocol's 50,000 URLs and 50 MB, and a `sitemapindex` of `/sitemap/{n}.xml` files once it does not. An unavailable API answers 503.

### Image delivery (`next/image`)

`images.loader: "custom"` / `loaderFile: "./lib/image-loader.ts"` in `next.config.ts` point `next/image` at the Manael conversion of the server's image routes. `lib/image-loader.ts` re-exports the shared loader; its specification is in [`packages/utils/README.md`](../../packages/utils/README.md). An `<Image>` whose source does not go through `/images` — a temporary `blob:` preview, for instance — is `unoptimized`.

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

The server encrypts every body it serves, free and entitled alike. A page that still arrives as an ordinary image is passed through untouched, which is what answers a reader a rolling deploy is still routing to an instance it has not replaced yet. What each body is bound to on the server side, and the `Cache-Control` it keeps, is in the [server README](../../server/README.md#image-delivery-manael).

`e2e/tests/storefront.viewer-performance.spec.ts` holds the drawing budget — time to the first page, the response and the drawn page of a page turn, and a cumulative layout shift of zero — against a seeded episode served through the server's image routes. The numbers, what each one covers, and how to measure them again are in [`e2e/README.md`](../../e2e/README.md).

### Brand images

`link rel="icon"` and `link rel="apple-touch-icon"` are resolved by `lib/tenant-icon.ts`, and the header's brand mark by `lib/tenant-logo.ts`. Both read the tenant's branding variants from `getTenantSiteInfo()`, and the server delivers them (`/images/tenants/{media_id}/icon`, `/images/tenants/{media_id}/logo`).

### Browser notifications (Web Push)

A signed-in reader can be told in the browser when a new episode is published. The switch is on `/settings/notifications`, and it appears only where the public API answers `GetTenant` with a VAPID public key — `getTenantWebPushPublicKey()` in `lib/tenant.ts`, over [the platform's Web Push settings](../../server/README.md#web-push).

| File | What it holds |
| --- | --- |
| `lib/service-worker.ts` | The worker's entry point, which Next.js compiles and serves from `_next/static/service-worker/` |
| `lib/service-worker-handlers.ts` | `push` and `notificationclick`: what is drawn, and where a tap lands |
| `lib/browser-push.ts` | The registration, the permission prompt, the subscription, and the shape `RegisterPushDevice` is given |
| `lib/push.ts` / `lib/push-actions.ts` | `RegisterPushDevice` / `UnregisterPushDevice`, and the Server Actions the switch and sign-out call |

### Episode purchase

The checkout button on a paid episode sends the reader to the URL `StartEpisodeCheckout` answers, which is the checkout of the payment provider the tenant chose. The reader comes back to the episode with `checkout=success` or `checkout=cancelled`, but the return opens nothing: the purchase the provider's notification records grants access to the body images. web-storefront holds no provider credentials. The return URL and the webhook are received on the tenant's public domain; the flow and each provider's setup are in the [server README](../../server/README.md#episode-purchases).

`POST /api/v1/webhook/payment/<provider>` receives every payment provider's notifications and forwards the raw body and the request headers to `ProcessPaymentWebhook` with the provider id; signatures are verified only on the API server. `POST /api/v1/webhook/payment/app-store` receives App Store Server Notifications V2 and forwards the raw body to `ProcessAppStoreNotification`.

### Inbound email

`POST /api/v1/webhook/email/<provider>` receives a reader's emailed reply from the tenant's inbound email provider (`sendgrid`, `resend`, or `mime`, and `mailgun` at `/api/v1/webhook/email/mailgun/json`, the URL a Mailgun Route posts JSON to) and forwards the raw body and the request headers to `ContactService.ProcessInboundEmailWebhook` with the provider id; the token and the signature are verified only on the API server. How the reply is matched to its contact message is in the [server README](../../server/README.md).

### Sign in with Apple and Google

`/login` and `/signup` offer a button for each provider `GetTenant` answers a client ID for, and `/settings/security` lists the providers linked to the account. A button sends the reader to the provider's authorization endpoint, which posts its answer to `POST /api/v1/auth/apple/callback` or `POST /api/v1/auth/google/callback` on the tenant's public domain; that is the redirect URI a tenant registers with Apple's Services ID and Google's web client. A first sign-in on a tenant that asks for consent to its terms continues on `/signup/continue`. An account without a password confirms its deletion on `/settings` and an email change on `/settings/security` with a fresh sign-in through the same callback, and `/settings/security` points it to `/reset-password` to set a first password. The flow is in `lib/social-sign-in.ts`.

### Agreeing to revised terms

A signed-in reader who has not agreed to a version of the terms of service or the privacy policy that asks every reader again is sent to `/settings/agreement` from whichever page under `(site)` they open, except the pages they are asked to read and `/settings`, where the account can be deleted instead, and comes back to that page once they agree. The layout reads the reader's agreements for the page it is rendered on, and after a client-side navigation, which keeps the layout, the page asks again through `checkLegalPageAgreementAction`. A Server Action or a render that the public API refuses with `LEGAL_PAGE_AGREEMENT_REQUIRED` is sent there by `withPublicSessionReauth` in `lib/auth-session.ts`. The reads are in `lib/legal-page-agreements.ts`.

## What it covers

- Public pages (privacy policy, terms of service, and so on)
- Catalog (series, episodes, creators, labels, genres, tags)
- Announcements, including the pinned one drawn as a banner above every page
- Authentication (sign in, sign up, password reset)
- Member area (my page, settings)
