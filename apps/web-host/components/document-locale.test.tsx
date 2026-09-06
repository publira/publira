// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DocumentLocale } from "./document-locale";

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("lang");
});

describe("DocumentLocale", () => {
  it("names the served locale on the document element", () => {
    render(<DocumentLocale locale="en" />);

    expect(document.documentElement.lang).toBe("en");
  });

  it("follows the reader to the language they switched to", () => {
    const { rerender } = render(<DocumentLocale locale="en" />);

    rerender(<DocumentLocale locale="ja" />);

    expect(document.documentElement.lang).toBe("ja");
  });

  it("writes the attribute back after a render that dropped it", () => {
    const { rerender } = render(<DocumentLocale locale="ja" />);
    document.documentElement.removeAttribute("lang");

    rerender(<DocumentLocale locale="en" />);

    expect(document.documentElement.lang).toBe("en");
  });
});
