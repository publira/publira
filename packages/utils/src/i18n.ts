/**
 * Locale parsing and message lookup for Server Components.
 *
 * Apps resolve Cookie / `root-params` themselves and pass the value in. This
 * module never reads request state, so it is safe to call from `"use cache"`
 * (the cache key is the locale argument, not a cookie).
 *
 * Catalogs live at the repo-root `locales/*.json` so Go, Next.js, and Flutter
 * read the same files. The loader takes per-locale `import()` functions —
 * never a template-string path — and `switch`es on {@link Locale}.
 */

/** First-cut UI locales. `ja` is the catalog source of truth. */
export const LOCALES = ["ja", "en"] as const;

export type Locale = (typeof LOCALES)[number];

/** Fallback when the value is missing or not in {@link LOCALES}. */
export const DEFAULT_LOCALE: Locale = "ja";

/** Cookie that stores the UI locale for apps that do not put lang in the URL. */
export const LOCALE_COOKIE_NAME = "publira_locale";

const LOCALE_SET: ReadonlySet<string> = new Set(LOCALES);

/** Named `{placeholder}` only — no ICU, no plurals. */
const PLACEHOLDER_RE = /\{[A-Za-z_][A-Za-z0-9_]*\}/gu;

const INTL_LOCALES = {
  en: "en-US",
  ja: "ja-JP",
} as const satisfies Record<Locale, string>;

export type MessageValues = Record<string, number | string>;

/**
 * Nested catalog. Leaves are the message strings. A dotted key such as
 * `locale.ja` walks this tree; a same-named top-level string key wins.
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

/** Unknown / empty / non-string values become {@link DEFAULT_LOCALE}. */
export const parseLocale = (value: unknown): Locale =>
  isLocale(value) ? value : DEFAULT_LOCALE;

/**
 * Parse the **value** of the locale cookie. Does not call `cookies()`.
 * Surrounding whitespace is trimmed; anything else unknown is `ja`.
 */
export const parseLocaleCookie = (value: string | null | undefined): Locale => {
  if (typeof value !== "string") {
    return DEFAULT_LOCALE;
  }

  return parseLocale(value.trim());
};

/** BCP 47 tag for `Intl.DateTimeFormat`. `<html lang>` stays `ja` / `en`. */
export const toIntlLocale = (locale: Locale): string => INTL_LOCALES[locale];

const hasDefaultExport = <TCatalog>(
  mod: CatalogModule<TCatalog>
): mod is { default: TCatalog } =>
  typeof mod === "object" &&
  mod !== null &&
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
 * `locale` is parsed so a raw cookie / segment value is safe to pass.
 */
export const loadMessages = async <TCatalog>(
  locale: Locale | string,
  importers: LocaleCatalogImporters<TCatalog>
): Promise<TCatalog> => {
  const resolved = parseLocale(locale);
  let loaded: CatalogModule<TCatalog>;

  switch (resolved) {
    case "en": {
      loaded = await importers.en();
      break;
    }
    case "ja": {
      loaded = await importers.ja();
      break;
    }
    default: {
      throw new Error(`Unsupported locale: ${String(resolved)}`);
    }
  }

  return unwrapCatalog(loaded);
};

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

const interpolate = (template: string, values?: MessageValues): string => {
  if (!values) {
    return template;
  }

  return template.replaceAll(PLACEHOLDER_RE, (match) => {
    const name = match.slice(1, -1);
    const value = values[name];
    return value === undefined ? match : String(value);
  });
};

const missingMessage = (key: string): string => {
  if (process.env.NODE_ENV === "production") {
    return key;
  }

  throw new Error(`Unknown message key: ${key}`);
};

/**
 * Return the string for `key`, with `{name}` replaced from `values`.
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

  return interpolate(message, values);
};
