/**
 * Locale parsing and message lookup.
 *
 * Apps resolve Cookie / `root-params` themselves and pass the value in. This
 * module never reads request state, so it is safe to call from `"use cache"`
 * (the cache key is the locale argument, not a cookie).
 *
 * Catalogs live at the repo-root `locales/*.json` so Go, Next.js, and Flutter
 * read the same files. Generated per-locale `import()` functions load the
 * catalog for {@link Locale}.
 */

import { profileCookieName } from "@publira/web-session/cookie-name";

import {
  getIntlLocale,
  getLocaleLabel as getLocaleLabelForSupportedLocale,
  getLocales,
} from "./gen/locale-registry";
import type { Locale } from "./gen/locale-registry";
import { formatSimpleMessage } from "./mf2";
import type { MessageValues } from "./mf2";

export { getLocales } from "./gen/locale-registry";
export type { Locale } from "./gen/locale-registry";
export type { MessageValues } from "./mf2";

/** Cookie that stores the UI locale for apps that do not put lang in the URL. */
export const LOCALE_COOKIE_NAME = profileCookieName("publira_locale");

/**
 * A year, in seconds. The locale is a preference rather than session state, so
 * the cookie is meant to outlive the sign-in that set it.
 */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Cookie that carries the display locale the **server** resolved, so the
 * browser can name it without a read of its own.
 *
 * It is not a choice and must never be treated as one: the app's proxy writes
 * the stored default it just read, and {@link LOCALE_COOKIE_NAME} — where an
 * app has one — always wins over it. Two things in the browser have no way to
 * reach that stored value otherwise — `<html lang>`, which a root layout does
 * not read, and the client error boundary, which renders precisely when the
 * API that holds the value is unreachable.
 * Without it both fall back to `Accept-Language`, so a console whose saved
 * language is `ja` answers an outage in English.
 *
 * The server never resolves a locale *from* this cookie. It reads the setting
 * itself, and this is the copy it leaves behind for the browser.
 */
export const RESOLVED_LOCALE_COOKIE_NAME = profileCookieName(
  "publira_resolved_locale"
);

/**
 * Source of the inline `<head>` script that applies the locale cookie to
 * `<html lang>` before the browser paints.
 *
 * An app that keeps the locale in a cookie cannot resolve `<html lang>` on the
 * server: under Cache Components a `cookies()` read above every `<Suspense>`
 * boundary leaves the route with no static shell, and the `<html>` element has
 * no child boundary the read could move into. So the root layout renders only
 * what it knows statically — in both consoles, no `lang` at all — and this
 * script writes the attribute while the document is still being parsed, the
 * pattern Next.js documents for cookie-driven `<html>` attributes ("How to
 * prevent flash before hydration").
 *
 * Two cookies can name that locale, and the script reads them in the order the
 * server resolves them: {@link LOCALE_COOKIE_NAME}, the reader's own choice,
 * then {@link RESOLVED_LOCALE_COOKIE_NAME}, the stored console default the
 * proxy resolved for this request. A value is applied when, and only when, it
 * is one of {@link getLocales}; when neither cookie names one the attribute is
 * left exactly as the server rendered it, so nothing here turns "no locale was
 * resolved" into a language. An undecodable value stops the script rather than
 * falling through — a cookie that cannot be read says nothing about which of
 * the two it was meant to be.
 *
 * Two things follow for the caller. The element needs
 * `suppressHydrationWarning`, because the DOM no longer matches what React
 * rendered. And the UI that changes the cookie has to set
 * `document.documentElement.lang` itself, once its Server Action resolved:
 * this script runs on a full page load only, and the statically rendered
 * attribute is identical across renders, so React has no reason to touch the
 * DOM after the Action.
 *
 * Everything interpolated below is a constant of this module, so no
 * request-derived value reaches the script source.
 */
export const LOCALE_LANG_SCRIPT = `(function(){try{var s=${JSON.stringify(getLocales())};var p=function(n){var m=document.cookie.match(new RegExp("(?:^|; )"+n+"=([^;]*)"));if(!m){return""}var l=decodeURIComponent(m[1]).trim();return s.indexOf(l)<0?"":l};var l=p(${JSON.stringify(LOCALE_COOKIE_NAME)})||p(${JSON.stringify(RESOLVED_LOCALE_COOKIE_NAME)});if(l){document.documentElement.lang=l}}catch(e){}})()`;

/**
 * Source of the inline `<head>` script that applies the locale the **URL**
 * names to `<html lang>`, for an app that keeps the locale in the path.
 *
 * `web-host` serves the tenant's default locale from an unprefixed path and
 * every other locale from `/{locale}/...`, so the first path segment names the
 * locale in every case but the default one — and there
 * {@link RESOLVED_LOCALE_COOKIE_NAME} carries the default the proxy resolved
 * for this very response. The script reads the two in that order and applies a
 * value only when it is one of {@link getLocales}; anything else leaves the
 * attribute exactly as the server rendered it, so nothing here turns "no
 * locale was resolved" into a language.
 *
 * The attribute is written rather than rendered because the element that
 * carries it belongs to a root layout, and a root layout does not read: an
 * `<html>` attribute has no child `<Suspense>` boundary a read could move
 * into, so awaiting there settles the whole tree before anything below it can
 * flush. The element therefore ships with no `lang` and with
 * `suppressHydrationWarning`, which is what lets the DOM this script produces
 * win over what React rendered.
 *
 * The same caveat applies as to {@link LOCALE_LANG_SCRIPT}, and for the same
 * reason: this runs on a full page load only. Moving between locales is a
 * client-side navigation there, which re-renders that attribute-less element,
 * so the app has to write `document.documentElement.lang` itself once the
 * navigation has committed.
 *
 * Everything interpolated below is a constant of this module, so no
 * request-derived value reaches the script source.
 */
export const PATH_LOCALE_LANG_SCRIPT = `(function(){try{var s=${JSON.stringify(getLocales())};var f=function(v){var l=(v||"").trim();return s.indexOf(l)<0?"":l};var l=f(location.pathname.split("/")[1]);if(!l){var m=document.cookie.match(new RegExp("(?:^|; )"+${JSON.stringify(RESOLVED_LOCALE_COOKIE_NAME)}+"=([^;]*)"));l=m?f(decodeURIComponent(m[1])):""}if(l){document.documentElement.lang=l}}catch(e){}})()`;

const LOCALE_SET: ReadonlySet<string> = new Set(getLocales());

/**
 * Nested catalog. Leaves are the message strings. A dotted key such as
 * `errors.validation` walks this tree; a same-named top-level string key wins.
 */
export interface MessageTree {
  readonly [key: string]: MessageTree | string;
}

/**
 * Dot-separated key of every string leaf in `T`.
 *
 * `getMessage` still accepts a plain `string` so a missing key can fall back
 * at runtime; this type is for autocomplete and for typed wrappers.
 */
export type MessageKey<T> = T extends MessageTree
  ? {
      [K in keyof T & string]: T[K] extends string
        ? K
        : T[K] extends MessageTree
          ? `${K}.${MessageKey<T[K]>}`
          : never;
    }[keyof T & string]
  : never;

/**
 * `Candidate` matches `Source` with no missing or extra keys (deep).
 *
 * Use this on JSON imports. `satisfies Source` only catches extras on object
 * literals; a `import catalog from "./en.json"` is a value, so structural
 * typing would let surplus keys through.
 *
 * ```ts
 * import en from "../../locales/en.json";
 * import ja from "../../locales/ja.json";
 *
 * export type Messages = typeof ja;
 * const _en: ExactCatalog<typeof en, Messages> = en;
 * ```
 */
export type ExactCatalog<Candidate, Source> = [Candidate] extends [Source]
  ? [Source] extends [Candidate]
    ? Candidate
    : never
  : never;

/**
 * `import()` of a JSON file or of `export default { … }` yields `{ default }`.
 * A loader that already unwrapped the module can pass the catalog through.
 */
export type CatalogModule<TCatalog> = TCatalog | { default: TCatalog };

/** One static `import()` per locale. Do not build the path with a template. */
export type LocaleCatalogImporters<TCatalog> = Record<
  Locale,
  () => Promise<CatalogModule<TCatalog>>
>;

export const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" && LOCALE_SET.has(value);

/**
 * The locale `value` names, or `undefined` when it names none.
 *
 * Unknown, empty, and non-string values are not locales, and nothing here
 * invents one for them. What a missing choice means — a stored tenant or
 * platform default, an `Accept-Language` candidate, or a failure the reader has
 * to be told about — differs per call site, so the caller decides it.
 */
export const parseLocale = (value: unknown): Locale | undefined =>
  isLocale(value) ? value : undefined;

/**
 * Parse the **value** of the locale cookie. Does not call `cookies()`.
 * Surrounding whitespace is trimmed; a cookie that is unset or holds anything
 * else is `undefined`, the same as no cookie at all.
 */
export const parseLocaleCookie = (
  value: string | null | undefined
): Locale | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  return parseLocale(value.trim());
};

/** BCP 47 tag for `Intl.DateTimeFormat`. `<html lang>` stays `ja` / `en`. */
export const toIntlLocale = (locale: Locale): string => getIntlLocale(locale);

/** Display name configured for a supported locale. */
export const getLocaleLabel = (locale: Locale): string =>
  getLocaleLabelForSupportedLocale(locale);

const isModuleNamespace = (value: object): boolean =>
  Object.prototype.toString.call(value) === "[object Module]";

const hasDefaultExport = <TCatalog>(
  mod: CatalogModule<TCatalog>
): mod is { default: TCatalog } =>
  typeof mod === "object" &&
  mod !== null &&
  isModuleNamespace(mod) &&
  "default" in mod &&
  typeof mod.default === "object" &&
  mod.default !== null;

const unwrapCatalog = <TCatalog>(mod: CatalogModule<TCatalog>): TCatalog => {
  if (hasDefaultExport(mod)) {
    return mod.default;
  }

  return mod;
};

/**
 * Load one locale's catalog. Only the matching importer runs, so bundlers
 * that split on `import()` keep the other locale out of the chunk.
 *
 * `locale` is already resolved. Run a raw cookie or segment value through
 * {@link parseLocale} first, so the decision about an unknown one is made where
 * that value came from rather than by whichever catalog happens to load.
 */
export const loadMessages = async <TCatalog>(
  locale: Locale,
  importers: LocaleCatalogImporters<TCatalog>
): Promise<TCatalog> => unwrapCatalog(await importers[locale]());

const isMessageTree = (value: unknown): value is MessageTree =>
  typeof value === "object" && value !== null;

const lookupMessage = (
  catalog: MessageTree,
  key: string
): string | undefined => {
  if (Object.hasOwn(catalog, key)) {
    const exact = catalog[key];
    if (typeof exact === "string") {
      return exact;
    }
  }

  let current: MessageTree | string = catalog;
  for (const part of key.split(".")) {
    if (!isMessageTree(current) || !Object.hasOwn(current, part)) {
      return undefined;
    }
    current = current[part];
  }

  return typeof current === "string" ? current : undefined;
};

/**
 * Format an already-resolved message as a MessageFormat 2 simple message:
 * `{$name}` placeholders are substituted from `values`, and `\\`, `\{`, `\}`
 * become the characters they escape.
 *
 * {@link getMessage} is the normal entry point. This one is for the rare
 * caller that holds a template rather than a catalog — a Client Component
 * handed one resolved string whose numbers are only known in the browser —
 * so the syntax stays in one place instead of being re-implemented against
 * the same shape.
 *
 * A message that is not a well-formed simple message throws outside
 * production, the way an unknown key does. In production the source is
 * returned: the spec lets the formatting context supply the fallback string
 * for a message it could not parse, and a stale client should not take the
 * page down.
 */
export const formatMessage = (
  template: string,
  values?: MessageValues
): string => {
  try {
    return formatSimpleMessage(template, values);
  } catch (error) {
    if (process.env.NODE_ENV === "production") {
      return template;
    }

    throw error;
  }
};

const missingMessage = (key: string): string => {
  if (process.env.NODE_ENV === "production") {
    return key;
  }

  throw new Error(`Unknown message key: ${key}`);
};

/**
 * Return the string for `key`, with `{$name}` replaced from `values`.
 *
 * Unknown keys throw outside production so a typo fails the request in
 * development. In production the key itself is returned, so a stale client
 * does not take down the page.
 */
export const getMessage = <TCatalog extends MessageTree>(
  catalog: TCatalog,
  key: MessageKey<TCatalog> | string,
  values?: MessageValues
): string => {
  if (!key) {
    return missingMessage(key);
  }

  const message = lookupMessage(catalog, key);
  if (message === undefined) {
    return missingMessage(key);
  }

  return formatMessage(message, values);
};
