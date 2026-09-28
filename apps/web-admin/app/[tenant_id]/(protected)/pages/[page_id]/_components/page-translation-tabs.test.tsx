// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PageTranslationTabs } from "./page-translation-tabs";

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"))(message, values),
}));

vi.mock("#lib/get-messages", () => ({
  getMessages: () => Promise.resolve(bindMessages(sharedCatalog("en"))),
}));

afterEach(() => {
  cleanup();
});

const renderTabs = async () =>
  render(
    await PageTranslationTabs({
      children: <button type="button">Delete this translation</button>,
      pageId: "PAGE001",
      selectedLocale: "en",
      translatedLocales: ["ja", "en"],
    })
  );

describe("PageTranslationTabs", () => {
  it("links every supported locale to that translation of the page", async () => {
    await renderTabs();

    const languages = screen.getByRole("navigation", { name: "Languages" });
    const links = [...languages.querySelectorAll("a")].map((link) =>
      link.getAttribute("href")
    );

    expect(links).toEqual([
      "/pages/PAGE001?locale=ja",
      "/pages/PAGE001?locale=en",
      "/pages/PAGE001?locale=ko",
      "/pages/PAGE001?locale=zh-Hans",
      "/pages/PAGE001?locale=zh-Hant",
    ]);
  });

  it("marks the translation on screen as the current one", async () => {
    await renderTabs();

    expect(
      screen.getByRole("link", { current: "page" }).getAttribute("href")
    ).toBe("/pages/PAGE001?locale=en");
  });

  it("names the locales the page has no translation in yet", async () => {
    await renderTabs();

    expect(screen.getByRole("link", { name: "English" })).toBeDefined();
    expect(
      screen.getByRole("link", { name: /^한국어\s?\(not added\)$/u })
    ).toBeDefined();
  });

  it("places the control for the selected translation beside the links", async () => {
    await renderTabs();

    expect(
      screen.getByRole("button", { name: "Delete this translation" })
    ).toBeDefined();
  });
});
