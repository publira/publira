// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { ClientMessage } from "./client-message";

const JA_TITLE = "Platform Console を表示できませんでした";
const EN_TITLE = "Could not display Platform Console";

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

/**
 * `navigator.languages` is read-only, and the point of every case below is what
 * the component does when the browser's own preference disagrees with the
 * console's.
 */
const setBrowserLanguages = (...languages: string[]) => {
  Object.defineProperty(navigator, "languages", {
    configurable: true,
    value: languages,
  });
};

/**
 * `<ClientMessage>` suspends on the catalog it loads, so the render is awaited:
 * `act` lets React flush the commit that follows the `import()` instead of
 * leaving the boundary on its fallback until the query times out.
 */
const renderTitle = async (): Promise<string> => {
  await act(() => {
    render(
      <Suspense fallback={null}>
        <ClientMessage message="platform.errors.root_title" />
      </Suspense>
    );
  });

  const rendered = await screen.findByText(
    new RegExp(`${JA_TITLE}|${EN_TITLE}`, "u")
  );

  return rendered.textContent ?? "";
};

/**
 * The error boundary is client-rendered, and it renders precisely when the
 * platform API is unreachable — so the saved default language reaches it as a
 * cookie the proxy published, or not at all.
 */
describe("ClientMessage", () => {
  afterEach(() => {
    cleanup();
    clearCookies();
    document.documentElement.lang = "";
  });

  it("renders in the locale the operator chose", async () => {
    setCookies("publira_locale=en", "publira_resolved_locale=ja");
    setBrowserLanguages("ja-JP", "ja");

    await expect(renderTitle()).resolves.toBe(EN_TITLE);
  });

  it("renders in the saved platform default when the operator chose nothing", async () => {
    setCookies("publira_resolved_locale=ja");
    setBrowserLanguages("en-US", "en");

    await expect(renderTitle()).resolves.toBe(JA_TITLE);
  });

  it("falls through to the saved default for an unsupported choice", async () => {
    setCookies("publira_locale=fr", "publira_resolved_locale=ja");
    setBrowserLanguages("en-US", "en");

    await expect(renderTitle()).resolves.toBe(JA_TITLE);
  });

  it("reads the document's own language when no cookie names one", async () => {
    document.documentElement.lang = "ja";
    setBrowserLanguages("en-US", "en");

    await expect(renderTitle()).resolves.toBe(JA_TITLE);
  });

  /**
   * A browser that has never had a console response — before setup, where the
   * platform has saved no language to publish.
   */
  it("negotiates from the browser when nothing else names a locale", async () => {
    setBrowserLanguages("en-US", "en");

    await expect(renderTitle()).resolves.toBe(EN_TITLE);
  });
});
