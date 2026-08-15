import { afterEach, describe, expect, it, vi } from "vitest";

import enCatalog from "../../../locales/en.json" with { type: "json" };
import jaCatalog from "../../../locales/ja.json" with { type: "json" };
import {
  DEFAULT_LOCALE,
  getMessage,
  isLocale,
  loadMessages,
  LOCALE_COOKIE_NAME,
  LOCALES,
  parseLocale,
  parseLocaleCookie,
  toIntlLocale,
} from "./i18n";
import type { ExactCatalog, Locale, MessageTree } from "./i18n";

const fixture = {
  greeting: "こんにちは、{name}さん",
  nav: {
    home: "ホーム",
  },
} as const;

const enFixture = {
  greeting: "Hello, {name}",
  nav: {
    home: "Home",
  },
} as const;

/** Compile-time: root `en.json` must match `ja.json` with no extra keys. */
const enMatchesJa: ExactCatalog<typeof enCatalog, typeof jaCatalog> = enCatalog;

const missing: unknown = undefined;

const asModuleNamespace = <T extends object>(value: T): T =>
  Object.defineProperty(value, Symbol.toStringTag, {
    value: "Module",
  });

describe("LOCALES", () => {
  it("starts with ja and en, default ja", () => {
    expect(LOCALES).toEqual(["ja", "en"]);
    expect(DEFAULT_LOCALE).toBe("ja");
    expect(LOCALE_COOKIE_NAME).toBe("publira_locale");
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
  it("maps UI locales to BCP 47 tags for Intl", () => {
    expect(toIntlLocale("ja")).toBe("ja-JP");
    expect(toIntlLocale("en")).toBe("en-US");
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

describe("getMessage", () => {
  it("returns the string for a top-level key", () => {
    expect(getMessage(fixture, "greeting")).toBe("こんにちは、{name}さん");
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

  it("interpolates {name} placeholders only", () => {
    expect(getMessage(fixture, "greeting", { name: "山田" })).toBe(
      "こんにちは、山田さん"
    );
    expect(getMessage(enFixture, "greeting", { name: "Ada" })).toBe(
      "Hello, Ada"
    );
  });

  it("leaves a placeholder in place when the value is missing", () => {
    expect(getMessage(fixture, "greeting", {})).toBe("こんにちは、{name}さん");
    expect(getMessage(fixture, "greeting")).toBe("こんにちは、{name}さん");
  });

  it("reads the shared root catalogs by dotted key", () => {
    expect(enMatchesJa).toBe(enCatalog);
    expect(getMessage(jaCatalog, "locale.ja")).toBe("日本語");
    expect(getMessage(enCatalog, "locale.en")).toBe("English");
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
