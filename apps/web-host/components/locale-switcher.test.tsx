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
  useHostMessages: () => sharedCatalog("ja"),
}));

vi.mock("./locale-provider", () => ({
  useLocale: () => "en",
  useTenantDefaultLocale: () => "ja",
}));

afterEach(cleanup);

describe("LocaleSwitcher", () => {
  it("現在のページへの実リンクをポップオーバーに表示する", () => {
    render(<LocaleSwitcher />);

    const trigger = screen.getByRole("button", {
      name: "表示言語: English",
    });
    trigger.focus();
    fireEvent.click(trigger);

    expect(screen.getByRole("dialog", { name: "表示言語" })).toBeDefined();
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
