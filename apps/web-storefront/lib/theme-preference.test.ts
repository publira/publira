// @vitest-environment jsdom

import { runInNewContext } from "node:vm";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyThemePreference,
  parseThemePreference,
  THEME_PREFERENCE_SCRIPT,
  THEME_PREFERENCE_STORAGE_KEY,
} from "./theme-preference";

/**
 * Runs the inlined script against a stub of the two globals it touches and
 * answers the `data-theme` it leaves, or `undefined` for none.
 */
const runScript = (localStorage: Pick<Storage, "getItem">) => {
  const dataset: DOMStringMap = {};
  const documentStub = { documentElement: { dataset } };
  runInNewContext(THEME_PREFERENCE_SCRIPT, {
    document: documentStub,
    localStorage,
  });

  return documentStub.documentElement.dataset.theme;
};

const storing = (value: string | null): Pick<Storage, "getItem"> => ({
  getItem: (key) => (key === THEME_PREFERENCE_STORAGE_KEY ? value : null),
});

afterEach(() => {
  delete document.documentElement.dataset.theme;
});

describe("parseThemePreference", () => {
  it("reads a stored light or dark choice", () => {
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("dark")).toBe("dark");
  });

  it("follows the system for nothing stored and for anything else", () => {
    expect(parseThemePreference(null)).toBe("system");
    expect(parseThemePreference("system")).toBe("system");
    expect(parseThemePreference("sepia")).toBe("system");
  });
});

describe("applyThemePreference", () => {
  it("names a light or dark choice on the document element", () => {
    applyThemePreference("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");

    applyThemePreference("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("removes the attribute for the system setting", () => {
    document.documentElement.dataset.theme = "dark";

    applyThemePreference("system");

    expect(Object.hasOwn(document.documentElement.dataset, "theme")).toBe(
      false
    );
  });
});

describe("THEME_PREFERENCE_SCRIPT", () => {
  it("applies a stored light or dark choice", () => {
    expect(runScript(storing("dark"))).toBe("dark");
    expect(runScript(storing("light"))).toBe("light");
  });

  it("leaves the attribute off for the system setting and for nothing stored", () => {
    expect(runScript(storing(null))).toBeUndefined();
    expect(runScript(storing("system"))).toBeUndefined();
    expect(runScript(storing("sepia"))).toBeUndefined();
  });

  it("does not throw where storage is refused", () => {
    const refused = {
      getItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
    };

    expect(runScript(refused)).toBeUndefined();
  });
});
