// @vitest-environment jsdom

import { DashboardIcon } from "@publira/icons";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ConsoleHeader,
  ConsoleHeaderActions,
  ConsoleHeaderContext,
  ConsoleHeaderEyebrow,
  ConsoleHeaderLabel,
  ConsoleHeaderText,
  ConsoleLayout,
  ConsoleLayoutSkeleton,
  ConsoleMobileNavigation,
  ConsoleMobileNavigationCloseButton,
  ConsoleMobileNavigationOpenButton,
  ConsoleSidebar,
  ConsoleSidebarBrand,
  ConsoleSidebarBrandLabel,
  ConsoleSidebarBrandName,
  ConsoleSidebarNavigation,
  ConsoleSidebarNavigationContent,
  ConsoleSidebarNavigationIcon,
  ConsoleSidebarNavigationItem,
  ConsoleSidebarNavigationItemDescription,
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

afterEach(cleanup);

describe("Console layout slots", () => {
  it("renders the header context and actions from child slots", () => {
    render(
      <ConsoleHeader>
        <ConsoleHeaderContext>
          <ConsoleHeaderText>
            <ConsoleHeaderEyebrow>Current tenant</ConsoleHeaderEyebrow>
            <ConsoleHeaderLabel>Example Publishing</ConsoleHeaderLabel>
          </ConsoleHeaderText>
        </ConsoleHeaderContext>
        <ConsoleHeaderActions>Notifications</ConsoleHeaderActions>
      </ConsoleHeader>
    );

    expect(screen.getByText("Current tenant")).toBeTruthy();
    expect(screen.getByText("Example Publishing")).toBeTruthy();
    expect(screen.getByText("Notifications")).toBeTruthy();
  });

  it("renders sidebar navigation from child slots", () => {
    render(
      <ConsoleSidebar>
        <ConsoleSidebarBrand>
          <ConsoleSidebarBrandName>Publira</ConsoleSidebarBrandName>
          <ConsoleSidebarBrandLabel>Platform Console</ConsoleSidebarBrandLabel>
        </ConsoleSidebarBrand>
        <ConsoleSidebarNavigation>
          <ConsoleSidebarNavigationSection>
            <ConsoleSidebarNavigationTitle>
              Operations
            </ConsoleSidebarNavigationTitle>
            <ConsoleSidebarNavigationItems>
              <ConsoleSidebarNavigationItem href="/">
                <ConsoleSidebarNavigationIcon>
                  <DashboardIcon className="size-5" />
                </ConsoleSidebarNavigationIcon>
                <ConsoleSidebarNavigationContent>
                  <ConsoleSidebarNavigationItemLabel>
                    Dashboard
                  </ConsoleSidebarNavigationItemLabel>
                  <ConsoleSidebarNavigationItemDescription>
                    Overview
                  </ConsoleSidebarNavigationItemDescription>
                </ConsoleSidebarNavigationContent>
              </ConsoleSidebarNavigationItem>
            </ConsoleSidebarNavigationItems>
          </ConsoleSidebarNavigationSection>
        </ConsoleSidebarNavigation>
      </ConsoleSidebar>
    );

    expect(
      screen.getByRole("link", { name: /Publira/u }).dataset.nextLink
    ).toBe("true");
    expect(
      screen.getByRole("link", { name: /dashboard/iu }).getAttribute("href")
    ).toBe("/");
  });

  it("uses navigation aria labels supplied by the caller", () => {
    render(
      <ConsoleLayout theme="admin">
        <ConsoleMobileNavigation>
          <ConsoleMobileNavigationCloseButton ariaLabel="Close navigation" />
        </ConsoleMobileNavigation>
        <ConsoleMobileNavigationOpenButton ariaLabel="Open navigation" />
        <div />
      </ConsoleLayout>
    );

    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));

    expect(
      screen.getByRole("button", { name: "Close navigation" })
    ).toBeTruthy();
  });
});

const consoleBackground = (container: HTMLElement) =>
  container.querySelector<HTMLElement>(".publira-console-background");

describe("Console background", () => {
  it.each(["admin", "platform"] as const)(
    "names the %s console on the background overlay",
    (theme) => {
      const { container } = render(
        <ConsoleLayout theme={theme}>
          <div />
        </ConsoleLayout>
      );

      expect(consoleBackground(container)?.dataset.consoleTheme).toBe(theme);
    }
  );

  it.each(["admin", "platform"] as const)(
    "gives the %s skeleton the same background overlay as the layout",
    (theme) => {
      const layout = render(
        <ConsoleLayout theme={theme}>
          <div />
        </ConsoleLayout>
      );
      const skeleton = render(<ConsoleLayoutSkeleton theme={theme} />);

      const layoutBackground = consoleBackground(layout.container);
      const skeletonBackground = consoleBackground(skeleton.container);

      expect(skeletonBackground?.className).toBe(layoutBackground?.className);
      expect(skeletonBackground?.dataset.consoleTheme).toBe(
        layoutBackground?.dataset.consoleTheme
      );
    }
  );
});
