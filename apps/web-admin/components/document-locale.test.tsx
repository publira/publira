// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DocumentLocale } from "./document-locale";

const setCookies = (...pairs: string[]) => {
  for (const pair of pairs) {
    document.cookie = `${pair}; path=/`;
  }
};

const clearCookies = () => {
  for (const entry of document.cookie.split(";")) {
    const name = entry.split("=")[0]?.trim();

    if (name) {
      document.cookie = `${name}=; path=/; max-age=0`;
    }
  }
};

afterEach(() => {
  cleanup();
  clearCookies();
  document.documentElement.removeAttribute("lang");
});

describe("DocumentLocale", () => {
  it("names the language the operator chose over the tenant default", () => {
    setCookies("publira_locale=ja", "publira_resolved_locale=en");

    render(<DocumentLocale />);

    expect(document.documentElement.lang).toBe("ja");
  });

  it("names the tenant default when the operator chose nothing", () => {
    setCookies("publira_resolved_locale=en");

    render(<DocumentLocale />);

    expect(document.documentElement.lang).toBe("en");
  });

  // A document that names no language is better for a screen reader than one
  // that names the wrong one.
  it("leaves the document naming no language when neither cookie names one", () => {
    setCookies("publira_locale=fr");

    render(<DocumentLocale />);

    expect(document.documentElement.hasAttribute("lang")).toBe(false);
  });
});
