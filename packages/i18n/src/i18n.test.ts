import { runInNewContext } from "node:vm";

import { afterEach, describe, expect, it, vi } from "vitest";

import enCatalog from "../../../locales/en.json" with { type: "json" };
import localeIndex from "../../../locales/index.json" with { type: "json" };
import jaCatalog from "../../../locales/ja.json" with { type: "json" };
import {
  DEFAULT_LOCALE,
  formatMessage,
  getLocales,
  getMessage,
  getLocaleLabel,
  isLocale,
  loadMessages,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_COOKIE_NAME,
  LOCALE_LANG_SCRIPT,
  parseLocale,
  parseLocaleCookie,
  toIntlLocale,
} from "./i18n";
import type { ExactCatalog, Locale, MessageTree } from "./i18n";

const fixture = {
  greeting: "こんにちは、{$name}さん",
  nav: {
    home: "ホーム",
  },
} as const;

const enFixture = {
  greeting: "Hello, {$name}",
  nav: {
    home: "Home",
  },
} as const;

/** Compile-time: root `en.json` must match `ja.json` with no extra keys. */
const enMatchesJa: ExactCatalog<typeof enCatalog, typeof jaCatalog> = enCatalog;

const missing: unknown = undefined;

/**
 * Run the script source the way a browser would, against a `document` stub.
 * Asserting on the string instead would pass on a script that never runs, and
 * a context is how the browser gets it — not a call this module makes.
 */
const applyLangScript = (cookie: string): string => {
  const documentStub = {
    cookie,
    documentElement: { lang: DEFAULT_LOCALE },
  };
  runInNewContext(LOCALE_LANG_SCRIPT, { document: documentStub });

  return documentStub.documentElement.lang;
};

const asModuleNamespace = <T extends object>(value: T): T =>
  Object.defineProperty(value, Symbol.toStringTag, {
    value: "Module",
  });

describe("getLocales", () => {
  it("matches the locale index", () => {
    expect(getLocales()).toEqual(localeIndex.locales.map(({ code }) => code));
    for (const { code, label } of localeIndex.locales) {
      expect(getLocaleLabel(code as Locale)).toBe(label);
    }
    expect(DEFAULT_LOCALE).toBe("ja");
    expect(LOCALE_COOKIE_NAME).toBe("publira_locale");
    expect(LOCALE_COOKIE_MAX_AGE).toBe(31_536_000);
  });

  it("returns a new array", () => {
    expect(getLocales()).not.toBe(getLocales());
  });
});

describe("LOCALE_LANG_SCRIPT", () => {
  it("applies a supported locale from the cookie", () => {
    expect(applyLangScript("publira_locale=en")).toBe("en");
    expect(applyLangScript("theme=dark; publira_locale=en; other=1")).toBe(
      "en"
    );
    expect(applyLangScript("publira_locale=%20en%20")).toBe("en");
  });

  it("leaves the rendered default in place for anything else", () => {
    expect(applyLangScript("")).toBe("ja");
    expect(applyLangScript("theme=dark")).toBe("ja");
    expect(applyLangScript("publira_locale=fr")).toBe("ja");
    expect(applyLangScript("publira_locale=")).toBe("ja");
    expect(applyLangScript("publira_locale=%E2%98%83")).toBe("ja");
    // A name that merely ends with the cookie name is a different cookie.
    expect(applyLangScript("not_publira_locale=en")).toBe("ja");
  });

  it("survives a cookie value that cannot be decoded", () => {
    expect(applyLangScript("publira_locale=%E0%A4%A")).toBe("ja");
  });
});

describe("isLocale", () => {
  it("accepts the supported locale codes", () => {
    expect(isLocale("ja")).toBe(true);
    expect(isLocale("en")).toBe(true);
  });

  it("rejects unknown or non-string values", () => {
    expect(isLocale("ja-JP")).toBe(false);
    expect(isLocale("JA")).toBe(false);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale("")).toBe(false);
    expect(isLocale(" ja ")).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(isLocale(missing)).toBe(false);
    expect(isLocale(1)).toBe(false);
  });
});

describe("parseLocale", () => {
  it("returns a known locale as-is", () => {
    expect(parseLocale("ja")).toBe("ja");
    expect(parseLocale("en")).toBe("en");
  });

  it("falls back to ja for unknown values", () => {
    expect(parseLocale("fr")).toBe("ja");
    expect(parseLocale("ja-JP")).toBe("ja");
    expect(parseLocale("")).toBe("ja");
    expect(parseLocale(null)).toBe("ja");
    expect(parseLocale(missing)).toBe("ja");
    expect(parseLocale({ locale: "en" })).toBe("ja");
  });
});

describe("parseLocaleCookie", () => {
  it("parses a bare cookie value without calling cookies()", () => {
    expect(parseLocaleCookie("en")).toBe("en");
    expect(parseLocaleCookie("ja")).toBe("ja");
  });

  it("trims whitespace and falls back to ja", () => {
    expect(parseLocaleCookie("  en  ")).toBe("en");
    expect(parseLocaleCookie("")).toBe("ja");
    expect(parseLocaleCookie("   ")).toBe("ja");
    expect(parseLocaleCookie("de")).toBe("ja");
    expect(parseLocaleCookie(null)).toBe("ja");
    expect(parseLocaleCookie(missing as string | undefined)).toBe("ja");
  });
});

describe("toIntlLocale", () => {
  it("maps each UI locale to its BCP 47 tag", () => {
    for (const { code, intl } of localeIndex.locales) {
      expect(toIntlLocale(code as Locale)).toBe(intl);
    }
  });
});

describe("loadMessages", () => {
  it("imports only the requested locale module", async () => {
    const imported: Locale[] = [];
    const catalog = await loadMessages<MessageTree>("en", {
      en: () => {
        imported.push("en");
        return Promise.resolve(enFixture);
      },
      ja: () => {
        imported.push("ja");
        return Promise.resolve(fixture);
      },
    });

    expect(imported).toEqual(["en"]);
    expect(catalog).toEqual(enFixture);
  });

  it("falls back to the ja importer for an unknown locale string", async () => {
    const imported: Locale[] = [];
    await loadMessages<MessageTree>("fr", {
      en: () => {
        imported.push("en");
        return Promise.resolve(enFixture);
      },
      ja: () => {
        imported.push("ja");
        return Promise.resolve(fixture);
      },
    });

    expect(imported).toEqual(["ja"]);
  });

  it("unwraps a default export from import()", async () => {
    const catalog = await loadMessages<MessageTree>("ja", {
      en: () => Promise.resolve(asModuleNamespace({ default: enFixture })),
      ja: () => Promise.resolve(asModuleNamespace({ default: fixture })),
    });

    expect(catalog).toEqual(fixture);
  });

  it("does not unwrap a catalog that has its own default object key", async () => {
    const catalogWithDefault = {
      default: { greeting: "既定" },
      other: "ほか",
    };
    const loaded = await loadMessages<MessageTree>("ja", {
      en: () => Promise.resolve(enFixture),
      ja: () => Promise.resolve(catalogWithDefault),
    });

    expect(loaded).toEqual(catalogWithDefault);
    expect(getMessage(loaded, "default.greeting")).toBe("既定");
  });
});

describe("formatMessage", () => {
  it("substitutes {$name} placeholders in a template", () => {
    expect(
      formatMessage("{$first} / {$total}ページ", { first: 3, total: 12 })
    ).toBe("3 / 12ページ");
  });

  it("unescapes the reserved characters", () => {
    expect(formatMessage("\\{ {$count} \\}", { count: 2 })).toBe("{ 2 }");
    expect(formatMessage("100\\\\200")).toBe("100\\200");
  });

  it("falls back to the variable reference when the value is missing", () => {
    expect(formatMessage("{$first} / {$total}", { first: 3 })).toBe(
      "3 / {$total}"
    );
    expect(formatMessage("{$first} / {$total}")).toBe("{$first} / {$total}");
  });

  it("throws on a message that is not a simple message", () => {
    expect(() => formatMessage("{count}")).toThrow(
      "Invalid MessageFormat 2 simple message"
    );
  });

  it("returns the source for an unparseable message in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(formatMessage("{count}")).toBe("{count}");
    vi.unstubAllEnvs();
  });
});

describe("getMessage", () => {
  it("returns the string for a top-level key", () => {
    expect(getMessage(fixture, "greeting")).toBe("こんにちは、{$name}さん");
  });

  it("walks dotted keys into nested objects", () => {
    expect(getMessage(fixture, "nav.home")).toBe("ホーム");
  });

  it("prefers an exact top-level key over a dotted path", () => {
    const catalog = {
      nav: { home: "入れ子" },
      "nav.home": "フラット",
    };
    expect(getMessage(catalog, "nav.home")).toBe("フラット");
  });

  it("interpolates {$name} placeholders only", () => {
    expect(getMessage(fixture, "greeting", { name: "山田" })).toBe(
      "こんにちは、山田さん"
    );
    expect(getMessage(enFixture, "greeting", { name: "Ada" })).toBe(
      "Hello, Ada"
    );
  });

  it("falls back to the variable reference when the value is missing", () => {
    expect(getMessage(fixture, "greeting", {})).toBe("こんにちは、{$name}さん");
    expect(getMessage(fixture, "greeting")).toBe("こんにちは、{$name}さん");
  });

  it("reads the shared root catalogs by dotted key", () => {
    expect(enMatchesJa).toBe(enCatalog);
    expect(getMessage(jaCatalog, "errors.rpc.unauthenticated")).toBe(
      "セッションが無効です。再ログインしてください。"
    );
    expect(getMessage(enCatalog, "errors.rpc.unauthenticated")).toBe(
      "Your session is no longer valid. Please sign in again."
    );
    expect(getMessage(jaCatalog, "errors.validation")).toBe(
      "入力内容を確認してください。"
    );
    expect(getMessage(enCatalog, "errors.validation")).toBe(
      "Please check the information you entered."
    );
  });

  describe("unknown keys", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("throws outside production", () => {
      vi.stubEnv("NODE_ENV", "development");
      expect(() => getMessage(fixture, "missing")).toThrow(
        "Unknown message key: missing"
      );
      expect(() => getMessage(fixture, "nav.missing")).toThrow(
        "Unknown message key: nav.missing"
      );
      expect(() => getMessage(fixture, "")).toThrow("Unknown message key: ");
    });

    it("returns the key in production", () => {
      vi.stubEnv("NODE_ENV", "production");
      expect(getMessage(fixture, "missing")).toBe("missing");
      expect(getMessage(fixture, "nav.missing")).toBe("nav.missing");
    });
  });
});
