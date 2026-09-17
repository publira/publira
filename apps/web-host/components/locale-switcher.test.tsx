// @vitest-environment jsdom

import { bindMessages, getLocales } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LocaleSwitcher,
  LocaleSwitcherLinks,
  LocaleSwitcherLinksSkeleton,
} from "./locale-switcher";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// The drawer row is a slot of the navigation drawer, whose own behaviour
// `packages/layouts` covers; here it stands in as the anchor it renders.
vi.mock("@publira/layouts", () => ({
  SiteLayoutMobileNavigationLink: ({
    children,
    current,
    ...props
  }: React.ComponentProps<"a"> & { current?: boolean }) => (
    <a aria-current={current ? "true" : undefined} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () =>
    "/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/en/series/series_01",
}));

vi.mock("./client-message", () => ({
  useClientMessages: () => bindMessages(sharedCatalog("en")),
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
      name: "Language",
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

describe("LocaleSwitcherLinks", () => {
  it("offers every locale as a link to the current page and marks the one in effect", () => {
    render(<LocaleSwitcherLinks />);

    expect(screen.getAllByRole("link")).toHaveLength(getLocales().length);
    expect(
      screen.getByRole("link", { name: "日本語" }).getAttribute("href")
    ).toBe("/series/series_01");
    expect(
      screen.getByRole("link", { name: "English" }).getAttribute("href")
    ).toBe("/en/series/series_01");
    expect(
      screen.getByRole("link", { name: "English" }).getAttribute("aria-current")
    ).toBe("true");
    expect(
      screen.getByRole("link", { name: "한국어" }).getAttribute("hreflang")
    ).toBe("ko");
  });
});

describe("LocaleSwitcherLinksSkeleton", () => {
  it("stands in with one row per locale the list draws", () => {
    const { container } = render(<LocaleSwitcherLinksSkeleton />);

    expect(
      container.querySelectorAll('[aria-hidden="true"] > div')
    ).toHaveLength(getLocales().length);
  });
});
