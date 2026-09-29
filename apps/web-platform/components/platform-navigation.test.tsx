// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlatformNavigation } from "./platform-navigation";

const { mockUsePathname } = vi.hoisted(() => ({
  mockUsePathname: vi.fn(() => "/"),
}));

vi.mock("./message", () => ({
  Message: ({ message }: { message: string }) => message,
}));

vi.mock("next/navigation", () => ({
  usePathname: mockUsePathname,
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
});

const currentHrefs = () =>
  screen
    .getAllByRole("link")
    .filter((link) => link.getAttribute("aria-current") === "page")
    .map((link) => link.getAttribute("href"));

/** The hrefs of the items listed under the section with this title. */
const sectionHrefs = (title: string) => {
  const section = screen.getByText(title).parentElement;
  if (!section) {
    throw new Error(`No section is titled ${title}`);
  }
  return within(section)
    .getAllByRole("link")
    .map((link) => link.getAttribute("href"));
};

describe("PlatformNavigation", () => {
  it("groups the settings pages into the Platform, Services, and Policies sections", () => {
    render(<PlatformNavigation />);

    expect(sectionHrefs("platform.nav.platform")).toEqual(["/general"]);
    expect(sectionHrefs("platform.nav.services")).toEqual([
      "/services/email",
      "/services/storage",
      "/services/webpush",
    ]);
    expect(sectionHrefs("platform.nav.policies")).toEqual([
      "/policies/security",
      "/policies/community",
      "/policies/retention",
    ]);
    expect(sectionHrefs("platform.nav.governance")).toEqual([
      "/operators",
      "/users",
      "/audit-logs",
    ]);
  });

  it("links to no page under /settings", () => {
    render(<PlatformNavigation />);

    expect(
      screen
        .getAllByRole("link")
        .map((link) => link.getAttribute("href"))
        .filter((href) => href?.startsWith("/settings"))
    ).toEqual([]);
  });

  it.each([
    "/general",
    "/services/email",
    "/services/storage",
    "/services/webpush",
    "/policies/security",
    "/policies/community",
    "/policies/retention",
  ])("marks %s as the current page", (pathname) => {
    mockUsePathname.mockReturnValue(pathname);

    render(<PlatformNavigation />);

    expect(currentHrefs()).toEqual([pathname]);
  });

  it("marks no item on the signed-in operator's own account page", () => {
    mockUsePathname.mockReturnValue("/account");

    render(<PlatformNavigation />);

    expect(currentHrefs()).toEqual([]);
  });
});
