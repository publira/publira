// @vitest-environment jsdom

import { DashboardIcon } from "@publira/icons";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as ConsoleLayout from ".";
import * as ConsoleHeader from "../console-header";
import * as ConsoleSidebar from "../console-sidebar";

vi.mock("next/link", () => ({
  default: ({
    children,
    prefetch,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => (
    <a
      {...props}
      data-next-link="true"
      data-prefetch={prefetch === undefined ? undefined : String(prefetch)}
    >
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
    <ConsoleSidebar.Root>
      <ConsoleSidebar.Brand>
        <ConsoleSidebar.BrandName>Publira</ConsoleSidebar.BrandName>
      </ConsoleSidebar.Brand>
      <ConsoleSidebar.Context>Platform Console</ConsoleSidebar.Context>
      <ConsoleSidebar.Navigation hrefs={hrefs}>
        <ConsoleSidebar.NavigationSection>
          <ConsoleSidebar.NavigationTitle>
            Tenants
          </ConsoleSidebar.NavigationTitle>
          <ConsoleSidebar.NavigationItems>
            {hrefs.map((href) => (
              <ConsoleSidebar.NavigationItem href={href} key={href}>
                <ConsoleSidebar.NavigationItemIcon>
                  <DashboardIcon className="size-4" />
                </ConsoleSidebar.NavigationItemIcon>
                <ConsoleSidebar.NavigationItemHeading>
                  <ConsoleSidebar.NavigationItemLabel>
                    {href}
                  </ConsoleSidebar.NavigationItemLabel>
                </ConsoleSidebar.NavigationItemHeading>
              </ConsoleSidebar.NavigationItem>
            ))}
          </ConsoleSidebar.NavigationItems>
        </ConsoleSidebar.NavigationSection>
      </ConsoleSidebar.Navigation>
    </ConsoleSidebar.Root>
  );

describe("Console layout slots", () => {
  it("renders the header context and actions from child slots", () => {
    render(
      <ConsoleHeader.Root>
        <ConsoleHeader.Context>
          <ConsoleHeader.Text>
            <ConsoleHeader.Label>Example Publishing</ConsoleHeader.Label>
          </ConsoleHeader.Text>
        </ConsoleHeader.Context>
        <ConsoleHeader.Actions>Notifications</ConsoleHeader.Actions>
      </ConsoleHeader.Root>
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

  it("does not prefetch a sidebar entry", () => {
    renderNavigation();

    for (const href of hrefs) {
      expect(screen.getByRole("link", { name: href }).dataset.prefetch).toBe(
        "false"
      );
    }

    expect(
      screen.getByRole("link", { name: /Publira/u }).dataset.prefetch
    ).toBeUndefined();
  });

  it("uses navigation aria labels supplied by the caller", () => {
    render(
      <ConsoleLayout.Root>
        <ConsoleLayout.MobileNavigation>
          <ConsoleLayout.MobileNavigationCloseButton aria-label="Close navigation" />
        </ConsoleLayout.MobileNavigation>
        <ConsoleLayout.MobileNavigationOpenButton aria-label="Open navigation" />
        <div />
      </ConsoleLayout.Root>
    );

    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));

    expect(
      screen.getByRole("button", { name: "Close navigation" })
    ).toBeTruthy();
  });

  it("wraps the popup in a viewport so swipe and scroll locking stay enabled", () => {
    render(
      <ConsoleLayout.Root>
        <ConsoleLayout.MobileNavigation>
          <ConsoleLayout.MobileNavigationCloseButton aria-label="Close navigation" />
        </ConsoleLayout.MobileNavigation>
        <ConsoleLayout.MobileNavigationOpenButton aria-label="Open navigation" />
        <div />
      </ConsoleLayout.Root>
    );

    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));

    const dialog = screen.getByRole("dialog");

    expect(dialog.parentElement?.role).toBe("presentation");
    expect(dialog.dataset.swipeDirection).toBe("left");
  });

  it("shows the sidebar's navigation in the open drawer and closes it on the entry followed", async () => {
    render(
      <ConsoleLayout.Root>
        <ConsoleLayout.MobileNavigation>
          <ConsoleLayout.MobileNavigationCloseButton aria-label="Close navigation" />
        </ConsoleLayout.MobileNavigation>
        <ConsoleLayout.MobileNavigationOpenButton aria-label="Open navigation" />
        <ConsoleSidebar.Root>
          <ConsoleSidebar.Navigation hrefs={hrefs}>
            <ConsoleSidebar.NavigationSection>
              <ConsoleSidebar.NavigationItems>
                <ConsoleSidebar.NavigationItem href="/tenants">
                  <ConsoleSidebar.NavigationItemHeading>
                    <ConsoleSidebar.NavigationItemLabel>
                      Tenants
                    </ConsoleSidebar.NavigationItemLabel>
                  </ConsoleSidebar.NavigationItemHeading>
                </ConsoleSidebar.NavigationItem>
              </ConsoleSidebar.NavigationItems>
            </ConsoleSidebar.NavigationSection>
          </ConsoleSidebar.Navigation>
        </ConsoleSidebar.Root>
      </ConsoleLayout.Root>
    );

    expect(screen.getAllByRole("link", { name: "Tenants" })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    const drawer = screen.getByRole("dialog");
    fireEvent.click(within(drawer).getByRole("link", { name: "Tenants" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });
});

const currentHrefs = () =>
  screen
    .getAllByRole("link")
    .filter((link) => link.getAttribute("aria-current") === "page")
    .map((link) => link.getAttribute("href"));

describe("Sidebar navigation active item", () => {
  it.each([
    {
      browserPath: "/tenants",
      current: "/tenants",
      title: "marks only the item whose path the browser is on",
    },
    {
      browserPath: "/tenants/new",
      current: "/tenants/new",
      title: "leaves a broader item to the more specific one that also matches",
    },
    {
      browserPath: "/1b4e28ba-2fa1-11d2-883f-0016d3cca427/tenants/SR01",
      current: "/tenants",
      title: "reads the same item as current before and after a tenant rewrite",
    },
  ])("$title", ({ browserPath, current }) => {
    pathname.mockReturnValue(browserPath);

    renderNavigation();

    expect(currentHrefs()).toEqual([current]);
  });
});
