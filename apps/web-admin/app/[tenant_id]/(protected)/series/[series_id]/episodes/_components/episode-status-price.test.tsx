// @vitest-environment jsdom

import type { Locale } from "@publira/i18n";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";

import { EpisodeStatusPrice } from "./episode-status-price";

afterEach(() => {
  cleanup();
});

const renderIn = (locale: Locale, status: string, price: number) =>
  render(
    <AdminLocaleTestProvider locale={locale}>
      <EpisodeStatusPrice price={price} status={status} />
    </AdminLocaleTestProvider>
  );

describe("EpisodeStatusPrice", () => {
  it.each([
    ["draft", 0, "Status: Draft / Price: ¥0"],
    ["scheduled", 120, "Status: Scheduled / Price: ¥120"],
    ["published", 1500, "Status: Published / Price: ¥1,500"],
  ])(
    "words the %s status instead of showing the enum value",
    (status, price, text) => {
      const { container } = renderIn("en", status, price);

      expect(container.textContent).toBe(text);
    }
  );

  // The Japanese copy is what proves the labels follow the chosen language.
  it("labels the status and the price in the chosen language", () => {
    const { container } = renderIn("ja", "published", 1500);

    expect(container.textContent).toBe("状態: 公開中 / 価格: ￥1,500");
  });
});
