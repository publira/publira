// @vitest-environment jsdom

import { bindMessages, getLocales } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StorefrontClientMessageKey } from "#lib/messages";

import * as LocaleSwitcher from "./locale-switcher";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// The disclosure and its rows are slots of the navigation drawer, whose own
// behaviour `packages/layouts` covers; here they stand in as the elements they
// render, the panel always open.
vi.mock("@publira/layouts/site-layout", () => ({
  MobileNavigationDisclosure: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  MobileNavigationDisclosurePanel: ({
    children,
  }: {
    children: React.ReactNode;
  }) => <div>{children}</div>,
  MobileNavigationDisclosureTrigger: ({
    children,
  }: {
    children: React.ReactNode;
  }) => <button type="button">{children}</button>,
  MobileNavigationLink: ({
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
  ClientMessage: ({ message }: { message: StorefrontClientMessageKey }) =>
    bindMessages(sharedCatalog("en"), "en")(message),
  useClientMessages: () => bindMessages(sharedCatalog("en"), "en"),
}));

const { mockUseTenantSupportedLocales } = vi.hoisted(() => ({
  mockUseTenantSupportedLocales: vi.fn(),
}));

vi.mock("./locale-context", () => ({
  useLocale: () => "en",
  useTenantDefaultLocale: () => "ja",
  useTenantSupportedLocales: mockUseTenantSupportedLocales,
}));

beforeEach(() => {
  mockUseTenantSupportedLocales.mockReturnValue(getLocales());
});

afterEach(cleanup);

describe("LocaleSwitcher", () => {
  it("lists both locales, the Japanese one by its own autonym, as links to the current page", () => {
    render(<LocaleSwitcher.Root />);

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

  it("renders nothing for a tenant that offers one locale", () => {
    mockUseTenantSupportedLocales.mockReturnValue(["en"]);

    const { container } = render(<LocaleSwitcher.Root />);

    expect(container.childElementCount).toBe(0);
  });

  it("renders nothing while the tenant's locales are unavailable", () => {
    mockUseTenantSupportedLocales.mockReturnValue(null);

    const { container } = render(<LocaleSwitcher.Root />);

    expect(container.childElementCount).toBe(0);
  });
});

describe("LocaleSwitcher.Disclosure", () => {
  it("offers every locale as a link to the current page and marks the one in effect", () => {
    render(<LocaleSwitcher.Disclosure />);

    expect(screen.getByRole("button", { name: "Language" })).toBeDefined();
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

  it("offers only the locales the tenant offers", () => {
    mockUseTenantSupportedLocales.mockReturnValue(["ja", "en"]);

    render(<LocaleSwitcher.Disclosure />);

    expect(
      screen.getAllByRole("link").map((link) => link.getAttribute("hreflang"))
    ).toStrictEqual(["ja", "en"]);
  });

  it("renders neither the row nor the links for a tenant that offers one locale", () => {
    mockUseTenantSupportedLocales.mockReturnValue(["en"]);

    const { container } = render(<LocaleSwitcher.Disclosure />);

    expect(container.childElementCount).toBe(0);
  });

  it("renders neither the row nor the links while the tenant's locales are unavailable", () => {
    mockUseTenantSupportedLocales.mockReturnValue(null);

    const { container } = render(<LocaleSwitcher.Disclosure />);

    expect(container.childElementCount).toBe(0);
  });
});

describe("LocaleSwitcher.DisclosureSkeleton", () => {
  it("stands in for the row without a control a keyboard can reach", () => {
    const { container } = render(<LocaleSwitcher.DisclosureSkeleton />);

    expect(container.querySelector("button")).toBeNull();
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe(
      "true"
    );
  });
});
