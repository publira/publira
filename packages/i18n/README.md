# `@publira/i18n`

The package that reads the repository-root [`locales/`](../../locales) catalogs from the TypeScript side, and holds the locale registry generated from `locales/index.json`.

The catalog itself — the file format, the MessageFormat 2 subset the leaves are written in, and how keys are organized — is documented in [`locales/README.md`](../../locales/README.md). This package is the reader: it parses a locale, loads the catalog for it, and formats one message.

Nothing here reads request state. `cookies()`, `headers()`, and `next/root-params` stay in the app, which resolves the locale and passes it in as an argument, so every function is safe to call from a `"use cache"` scope — the cache key is the locale, not a cookie.

## Subpaths

| Import | What it provides |
| --- | --- |
| `@publira/i18n` | Locale parsing and negotiation, the cookie names, and `getMessage` / `formatMessage` |
| `@publira/i18n/catalog` | The catalog imported statically, so the shared `errors.*` copy can be read without awaiting |
| `@publira/i18n/messages` | `loadLocaleMessages`, the generated per-locale `import()` map |

## What it provides

### Locales

| Export | What it is |
| --- | --- |
| `Locale` | The union of the codes in `locales/index.json` (`"ja" \| "en"`) |
| `getLocales()` | Those codes, in the order the file lists them |
| `isLocale` / `parseLocale` | Narrow an unknown value to a `Locale`, or `undefined` |
| `parseLocaleCookie` | The same for a cookie **value** (trimmed). It does not call `cookies()` |
| `negotiateInitialLocale` | The locale to open on for an `Accept-Language` header, for a screen with no identified reader and therefore no stored preference |
| `getLocaleLabel` | The display name for the locale switcher (`日本語` / `English`) |
| `toIntlLocale` | The BCP 47 tag for `Intl` (`ja-JP` / `en-US`). `<html lang>` keeps the short code |

`src/accept-language.test.ts` is the specification of what `negotiateInitialLocale` does with a header, and `src/i18n.test.ts` of the rest.

### Messages

| Export | What it is |
| --- | --- |
| `getMessage(catalog, key, values?)` | The string at a dotted key, with `{$name}` substituted from `values` |
| `formatMessage(template, values?)` | The same substitution against a template the caller already holds |
| `MessageKey<T>` | The dotted key of every string leaf of a catalog, for autocomplete and typed wrappers |
| `MessageTree` / `MessageValues` / `CatalogModule` / `ExactCatalog` / `LocaleCatalogImporters` | The catalog shapes. `ExactCatalog` is what rejects a locale file with a missing or extra key |
| `loadMessages(locale, importers)` | Loads one locale through a static `import()` map, so a bundler keeps the other locales out of the chunk |

### Cookies and `<html lang>`

For the apps that keep the UI locale in a cookie rather than in the URL:

| Export | What it is |
| --- | --- |
| `LOCALE_COOKIE_NAME` | The reader's own choice |
| `LOCALE_COOKIE_MAX_AGE` | The `Max-Age` that cookie is written with, in seconds |
| `RESOLVED_LOCALE_COOKIE_NAME` | The stored console default the server resolved, written by the app's `proxy.ts` so the browser can name it without a read of its own |
| `LOCALE_LANG_SCRIPT` | The inline `<head>` script that applies those cookies to `<html lang>` before the browser paints |
| `PATH_LOCALE_LANG_SCRIPT` | The same for an app that keeps the locale in the path, such as `web-host` |

Both cookie names go through `profileCookieName` from [`@publira/web-session`](../web-session), so a local development profile gets its own.

## Usage

```ts
// The app resolves the locale, then loads the catalog for it.
import type { Locale, MessageKey } from "@publira/i18n";
import type { SharedMessages } from "@publira/i18n/catalog";
import { loadLocaleMessages } from "@publira/i18n/messages";

export type HostMessages = SharedMessages;
export type HostMessageKey = MessageKey<HostMessages>;

export const loadHostMessages = (locale: Locale): Promise<HostMessages> =>
  loadLocaleMessages(locale) as Promise<HostMessages>;
```

```tsx
import { getMessage } from "@publira/i18n";

const messages = await loadHostMessages(locale);

<h1>{getMessage(messages, "host.series.list_title")}</h1>;
<p>{getMessage(messages, "host.series.list_description", { site })}</p>;
```

A `{$name}` placeholder is substituted as a string. Format a date or a number with `@publira/utils` first, against the tenant's time zone and the UI locale, and pass the result in.

### The shared catalog (`./catalog`)

`sharedCatalog` and `sharedMessage` read the catalog through a static import, so they can run where nothing can be awaited — inside a `catch` or a zod `safeParse`. Both locales end up in the chunk, which is why per-screen copy still goes through `./messages`.

```ts
import { sharedRpcErrorMessage } from "@publira/i18n/catalog";

// The shared wording for one RPC failure category, or `undefined` when that
// category (`precondition` / `unexpected`) has no shared copy.
const message = sharedRpcErrorMessage(disposition, locale);
```

### Resolving a locale on the server

```ts
import {
  LOCALE_COOKIE_NAME,
  negotiateInitialLocale,
  parseLocaleCookie,
} from "@publira/i18n";
import { cookies, headers } from "next/headers";

const cookieStore = await cookies();
const chosen = parseLocaleCookie(cookieStore.get(LOCALE_COOKIE_NAME)?.value);
if (chosen) {
  return chosen;
}

const requestHeaders = await headers();

return negotiateInitialLocale(requestHeaders.get("accept-language"));
```

## Generated files

Everything under `src/gen/` is generated by `scripts/generate-locale-registry.ts` from `locales/index.json` and the catalog files. Never edit it by hand.

| File | What it holds |
| --- | --- |
| `locale-registry.ts` | `Locale`, `getLocales`, and the per-locale `intl` tag and display label |
| `locale-catalogs.ts` | The static `CATALOGS` map behind `./catalog`, with the `ExactCatalog` checks |
| `locale-messages.ts` | The per-locale `import()` map behind `./messages` |
| `locale-message-types.d.ts` | The types `./catalog` publishes |

Adding a locale or a key is described under "Adding a key" and "Adding a locale" in [`locales/README.md`](../../locales/README.md). After either, run `pnpm locales:generate` at the repository root.

## Commands

```bash
pnpm locales:check   # every leaf is a valid simple message
pnpm locales:generate # regenerate src/gen/

pnpm --filter @publira/i18n test
pnpm --filter @publira/i18n typecheck # the ExactCatalog checks run here
pnpm --filter @publira/i18n build
```
