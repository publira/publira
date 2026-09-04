// @vitest-environment jsdom

import { sharedCatalog } from "@publira/i18n/catalog";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocaleSwitcher } from "./locale-switcher";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () =>
    "/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/en/series/series_01",
}));

vi.mock("./client-message", () => ({
  useHostMessages: () => sharedCatalog("en"),
}));

vi.mock("./locale-provider", () => ({
  useLocale: () => "en",
  useTenantDefaultLocale: () => "ja",
}));

afterEach(cleanup);

describe("LocaleSwitcher", () => {
  it("lists both locales, the Japanese one by its own autonym, as links to the current page", () => {
    render(<LocaleSwitcher />);

    const trigger = screen.getByRole("button", {
      name: "Language: English",
    });
    trigger.focus();
    fireEvent.click(trigger);

    expect(screen.getByRole("dialog", { name: "Language" })).toBeDefined();
    expect(
      screen.getByRole("link", { name: "日本語" }).getAttribute("href")
    ).toBe("/series/series_01");
    expect(
      screen.getByRole("link", { name: "English" }).getAttribute("href")
    ).toBe("/en/series/series_01");
    expect(
      screen.getByRole("link", { name: "English" }).getAttribute("aria-current")
    ).toBe("true");

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
