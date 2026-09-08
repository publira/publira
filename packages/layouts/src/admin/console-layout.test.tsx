// @vitest-environment jsdom

import { DashboardIcon } from "@publira/icons";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ConsoleHeader,
  ConsoleHeaderActions,
  ConsoleHeaderContext,
  ConsoleHeaderLabel,
  ConsoleHeaderText,
  ConsoleLayout,
  ConsoleMobileNavigation,
  ConsoleMobileNavigationCloseButton,
  ConsoleMobileNavigationOpenButton,
  ConsoleSidebar,
  ConsoleSidebarBrand,
  ConsoleSidebarBrandName,
  ConsoleSidebarContext,
  ConsoleSidebarNavigation,
  ConsoleSidebarNavigationItem,
  ConsoleSidebarNavigationItemHeading,
  ConsoleSidebarNavigationItemIcon,
  ConsoleSidebarNavigationItemLabel,
  ConsoleSidebarNavigationItems,
  ConsoleSidebarNavigationSection,
  ConsoleSidebarNavigationTitle,
} from "./console-layout";

vi.mock("next/link", () => ({
  default: ({
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props} data-next-link="true">
      {children}
    </a>
  ),
}));

const pathname = vi.fn(() => "/");

vi.mock("next/navigation", () => ({
  usePathname: () => pathname(),
}));

afterEach(cleanup);

beforeEach(() => {
  pathname.mockReturnValue("/");
});

const hrefs = ["/", "/tenants", "/tenants/new"];

const renderNavigation = () =>
  render(
    <ConsoleSidebar>
      <ConsoleSidebarBrand>
        <ConsoleSidebarBrandName>Publira</ConsoleSidebarBrandName>
      </ConsoleSidebarBrand>
      <ConsoleSidebarContext>Platform Console</ConsoleSidebarContext>
      <ConsoleSidebarNavigation hrefs={hrefs}>
        <ConsoleSidebarNavigationSection>
          <ConsoleSidebarNavigationTitle>Tenants</ConsoleSidebarNavigationTitle>
          <ConsoleSidebarNavigationItems>
            {hrefs.map((href) => (
              <ConsoleSidebarNavigationItem href={href} key={href}>
                <ConsoleSidebarNavigationItemIcon>
                  <DashboardIcon className="size-4" />
                </ConsoleSidebarNavigationItemIcon>
                <ConsoleSidebarNavigationItemHeading>
                  <ConsoleSidebarNavigationItemLabel>
                    {href}
                  </ConsoleSidebarNavigationItemLabel>
                </ConsoleSidebarNavigationItemHeading>
              </ConsoleSidebarNavigationItem>
            ))}
          </ConsoleSidebarNavigationItems>
        </ConsoleSidebarNavigationSection>
      </ConsoleSidebarNavigation>
    </ConsoleSidebar>
  );

describe("Console layout slots", () => {
  it("renders the header context and actions from child slots", () => {
    render(
      <ConsoleHeader>
        <ConsoleHeaderContext>
          <ConsoleHeaderText>
            <ConsoleHeaderLabel>Example Publishing</ConsoleHeaderLabel>
          </ConsoleHeaderText>
        </ConsoleHeaderContext>
        <ConsoleHeaderActions>Notifications</ConsoleHeaderActions>
      </ConsoleHeader>
    );

    expect(screen.getByText("Example Publishing")).toBeTruthy();
    expect(screen.getByText("Notifications")).toBeTruthy();
  });

  it("renders sidebar navigation from child slots", () => {
    renderNavigation();

    expect(
      screen.getByRole("link", { name: /Publira/u }).dataset.nextLink
    ).toBe("true");
    expect(screen.getByText("Platform Console")).toBeTruthy();
    expect(screen.getByRole("link", { name: "/tenants" })).toBeTruthy();
  });

  it("uses navigation aria labels supplied by the caller", () => {
    render(
      <ConsoleLayout>
        <ConsoleMobileNavigation>
          <ConsoleMobileNavigationCloseButton aria-label="Close navigation" />
        </ConsoleMobileNavigation>
        <ConsoleMobileNavigationOpenButton aria-label="Open navigation" />
        <div />
      </ConsoleLayout>
    );

    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));

    expect(
      screen.getByRole("button", { name: "Close navigation" })
    ).toBeTruthy();
  });
});

const currentHrefs = () =>
  screen
    .getAllByRole("link")
    .filter((link) => link.getAttribute("aria-current") === "page")
    .map((link) => link.getAttribute("href"));

describe("Sidebar navigation active item", () => {
  it("marks only the item whose path the browser is on", () => {
    pathname.mockReturnValue("/tenants");

    renderNavigation();

    expect(currentHrefs()).toEqual(["/tenants"]);
  });

  it("leaves a broader item to the more specific one that also matches", () => {
    pathname.mockReturnValue("/tenants/new");

    renderNavigation();

    expect(currentHrefs()).toEqual(["/tenants/new"]);
  });

  it("reads the same item as current before and after a tenant rewrite", () => {
    pathname.mockReturnValue(
      "/1b4e28ba-2fa1-11d2-883f-0016d3cca427/tenants/SR01"
    );

    renderNavigation();

    expect(currentHrefs()).toEqual(["/tenants"]);
  });
});
