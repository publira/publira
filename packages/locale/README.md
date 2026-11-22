# `@publira/locale`

The `[locale]` root segment shared by `web-storefront`, `web-admin`, and `web-platform`.

`@publira/i18n` parses a locale and formats a message, and never reads a request. This package reads the `locale` root parameter, binds one app's catalog to it, and, for the two consoles, turns the `publira_locale` cookie into the segment a `proxy.ts` rewrites onto.

`next` and `react` are peerDependencies, so the app's own copies are what run. There is no package barrel: import a subpath.

`getLocale` imports `locale` from `next/root-params`. A package typecheck cannot see the root-parameter exports Next.js generates per app, so `src/next-root-params.d.ts` declares the one export every root layout has. That file is not a build entry. The Next.js compiler replaces `next/root-params` while it bundles the importing app, which is what lets a `"use cache"` scope that calls `getLocale` record `locale` on its cache key.

## Subpaths

| Import | What it provides |
| --- | --- |
| `@publira/locale/root-locale` | `getLocale()`, the `[locale]` root parameter. An unsupported value is `notFound()`. Server Actions and Route Handlers have no root parameters |
| `@publira/locale/get-messages` | `createGetMessages(load, getLocale)`, an app's `getMessages()`. `getLocale` is that app's root-parameter reader |
| `@publira/locale/message` | `createMessage(getMessages)`, an app's server `<Message>` |
| `@publira/locale/client-messages` | `createClientMessages`, the client catalog and its `<ClientMessage>` / `useClientMessages()`. `"use client"` |
| `@publira/locale/messages-provider` | `createLocaleMessagesProvider`, the server component that starts the catalog read and the locale read and awaits neither |
| `@publira/locale/locale-field` | `LOCALE_FIELD_NAME`, the console switcher's form field. Client-safe |
| `@publira/locale/locale-cookie` | `localeCookieOptions` and `persistLocaleChoice`. The app's `"use server"` file checks the origin, then calls it |
| `@publira/locale/console-locale` | `consoleRequestLocale` and `consoleLocalePathname`, for a console `proxy.ts`. The caller builds the `NextResponse` |
| `@publira/locale/static-params` | `generateLocaleStaticParams`, one `generateStaticParams` entry per registry locale |

## What stays in the app

| What | Where |
| --- | --- |
| The catalog namespace and its loaders | Each app's `lib/messages.ts` (`admin`, `platform`, or `storefront`) |
| `getMessagesFor(locale)` | Each app's `lib/messages.ts`, for a caller that already holds a `Locale` |
| `getAdminLocale(tenantId)` | `web-admin`'s `lib/locale.ts`. The tenant read and the `503` on a failed read stay there |
| `getPlatformLocale()` | `web-platform`'s `lib/locale.ts`. `Accept-Language`, while nothing is saved, and the last confirmed language through an outage stay there |
| `tenant_id` | `web-admin` and `web-storefront` |
| A session's `cookies()` | Each app |
| The storefront's path helpers and language switcher | `web-storefront`'s `lib/locale-path.ts`, `components/locale-link.tsx`, and `components/locale-switcher.tsx`. The locale is in the URL |
| The storefront's hidden locale field | `web-storefront`'s `lib/locale-form.ts` |
| The console switcher and the refresh after the action | Each console's `components/locale-switcher.tsx` and `components/locale-switcher-root.tsx` |
