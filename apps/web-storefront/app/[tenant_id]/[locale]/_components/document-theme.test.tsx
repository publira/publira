// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { THEME_PREFERENCE_STORAGE_KEY } from "#lib/theme-preference";
import { writeWebStorage } from "#lib/web-storage";

import { DocumentTheme } from "./document-theme";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe("DocumentTheme", () => {
  it("names the stored choice on the document element", () => {
    window.localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, "dark");

    render(<DocumentTheme />);

    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("follows a choice made on the switch", () => {
    render(<DocumentTheme />);

    act(() => {
      writeWebStorage("local", THEME_PREFERENCE_STORAGE_KEY, "light");
    });
    expect(document.documentElement.dataset.theme).toBe("light");

    act(() => {
      writeWebStorage("local", THEME_PREFERENCE_STORAGE_KEY, "system");
    });
    expect(Object.hasOwn(document.documentElement.dataset, "theme")).toBe(
      false
    );
  });

  it("follows a choice made in another of the site's tabs", () => {
    render(<DocumentTheme />);

    window.localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, "dark");
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: THEME_PREFERENCE_STORAGE_KEY,
          newValue: "dark",
          storageArea: window.localStorage,
        })
      );
    });

    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
