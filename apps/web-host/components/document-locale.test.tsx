// @vitest-environment jsdom

import type { Locale } from "@publira/i18n";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DocumentLocale } from "./document-locale";
import { LocaleContextProvider } from "./locale-context";

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("lang");
});

// Already fulfilled, as the RSC payload delivers it, so `use()` answers now.
const servedIn = (locale: Locale) => (
  <LocaleContextProvider
    locale={Object.assign(Promise.resolve(locale), {
      status: "fulfilled",
      value: locale,
    })}
  >
    <DocumentLocale />
  </LocaleContextProvider>
);

describe("DocumentLocale", () => {
  it("names the served locale on the document element", () => {
    render(servedIn("en"));

    expect(document.documentElement.lang).toBe("en");
  });

  it("follows the reader to the language they switched to", () => {
    const { rerender } = render(servedIn("en"));

    rerender(servedIn("ja"));

    expect(document.documentElement.lang).toBe("ja");
  });

  it("writes the attribute back after a render that dropped it", () => {
    const { rerender } = render(servedIn("ja"));
    document.documentElement.removeAttribute("lang");

    rerender(servedIn("en"));

    expect(document.documentElement.lang).toBe("en");
  });
});
