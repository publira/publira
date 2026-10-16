import { getLocales } from "@publira/i18n";
import { describe, expect, it } from "vitest";

import {
  resolveTranslationLocales,
  resolveTranslationToEdit,
  translationEditPath,
} from "./translation-locales";

const JA_EN_KO = {
  defaultLocale: "ja",
  supportedLocales: ["ja", "en", "ko"],
} as const;

describe("resolveTranslationLocales", () => {
  it("gives a tab to every language the site offers and opens the default one", () => {
    expect(
      resolveTranslationLocales({
        requestedLocale: undefined,
        tenantLocales: JA_EN_KO,
        translatedLocales: ["en", "ja"],
      })
    ).toEqual({
      locales: ["ja", "en", "ko"],
      shownLocale: "ja",
      visibleLocales: ["en", "ja"],
    });
  });

  it("opens the language the URL names", () => {
    expect(
      resolveTranslationLocales({
        requestedLocale: "ko",
        tenantLocales: JA_EN_KO,
        translatedLocales: ["ja"],
      }).shownLocale
    ).toBe("ko");
  });

  it("ignores a language the URL names that the site does not offer", () => {
    expect(
      resolveTranslationLocales({
        requestedLocale: "zh-Hant",
        tenantLocales: JA_EN_KO,
        translatedLocales: ["ja"],
      }).shownLocale
    ).toBe("ja");
  });

  it("opens the oldest offered translation when the default language has none", () => {
    expect(
      resolveTranslationLocales({
        requestedLocale: undefined,
        tenantLocales: JA_EN_KO,
        translatedLocales: ["zh-Hans", "en", "ko"],
      })
    ).toEqual({
      locales: ["ja", "en", "ko"],
      shownLocale: "en",
      // A translation in a language the site no longer offers has no tab.
      visibleLocales: ["en", "ko"],
    });
  });

  it("opens the default language, to add one, when no offered language has a translation", () => {
    expect(
      resolveTranslationLocales({
        requestedLocale: undefined,
        tenantLocales: JA_EN_KO,
        translatedLocales: ["zh-Hans"],
      }).shownLocale
    ).toBe("ja");
  });

  it("gives every language this build serves a tab, and leaves the choice to the API, when the site's languages cannot be read", () => {
    expect(
      resolveTranslationLocales({
        requestedLocale: undefined,
        tenantLocales: null,
        translatedLocales: ["en"],
      })
    ).toEqual({
      locales: getLocales(),
      shownLocale: undefined,
      visibleLocales: ["en"],
    });
  });
});

describe("resolveTranslationToEdit", () => {
  const translations = [
    { locale: "ja", title: "The first title" },
    { locale: "en", title: "An English title" },
  ] as const;

  it("answers the translation in the language the form opens on", () => {
    expect(
      resolveTranslationToEdit({
        requestedLocale: "en",
        tenantLocales: JA_EN_KO,
        translations,
      })
    ).toMatchObject({
      shownLocale: "en",
      translation: { locale: "en", title: "An English title" },
    });
  });

  it("answers no translation on a language's tab that has none yet", () => {
    expect(
      resolveTranslationToEdit({
        requestedLocale: "ko",
        tenantLocales: JA_EN_KO,
        translations,
      })
    ).toMatchObject({ shownLocale: "ko", translation: undefined });
  });

  it("opens the oldest translation when the site's languages cannot be read", () => {
    expect(
      resolveTranslationToEdit({
        requestedLocale: undefined,
        tenantLocales: null,
        translations,
      })
    ).toMatchObject({
      shownLocale: "ja",
      translation: { locale: "ja", title: "The first title" },
    });
  });
});

describe("translationEditPath", () => {
  it("names the language and the flag the toast reads", () => {
    expect(translationEditPath("/series/SERIES001", "en", "updated")).toBe(
      "/series/SERIES001?locale=en&updated=1"
    );
  });

  it("leaves the language to the screen when none is given", () => {
    expect(
      translationEditPath("/series/SERIES001", undefined, "translation_deleted")
    ).toBe("/series/SERIES001?translation_deleted=1");
    expect(translationEditPath("/series/SERIES001")).toBe("/series/SERIES001");
  });
});
