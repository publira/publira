// @vitest-environment jsdom

import { DashboardIcon } from "@publira/icons";
import { cleanup, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ConsoleHeader,
  ConsoleHeaderActions,
  ConsoleHeaderContext,
  ConsoleHeaderEyebrow,
  ConsoleHeaderLabel,
  ConsoleHeaderText,
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
  it("ヘッダーのコンテキストとアクションを子スロットで構成する", () => {
    render(
      <ConsoleHeader>
        <ConsoleHeaderContext>
          <ConsoleHeaderText>
            <ConsoleHeaderEyebrow>現在の運用先</ConsoleHeaderEyebrow>
            <ConsoleHeaderLabel>青枝出版</ConsoleHeaderLabel>
          </ConsoleHeaderText>
        </ConsoleHeaderContext>
        <ConsoleHeaderActions>通知</ConsoleHeaderActions>
      </ConsoleHeader>
    );

    expect(screen.getByText("現在の運用先")).toBeTruthy();
    expect(screen.getByText("青枝出版")).toBeTruthy();
    expect(screen.getByText("通知")).toBeTruthy();
  });

  it("サイドバーのナビゲーションを子スロットで構成する", () => {
    render(
      <ConsoleSidebar>
        <ConsoleSidebarBrand>
          <ConsoleSidebarBrandName>Publira</ConsoleSidebarBrandName>
          <ConsoleSidebarBrandLabel>Platform Console</ConsoleSidebarBrandLabel>
        </ConsoleSidebarBrand>
        <ConsoleSidebarNavigation>
          <ConsoleSidebarNavigationSection>
            <ConsoleSidebarNavigationTitle>運用</ConsoleSidebarNavigationTitle>
            <ConsoleSidebarNavigationItems>
              <ConsoleSidebarNavigationItem href="/">
                <ConsoleSidebarNavigationIcon>
                  <DashboardIcon className="size-5" />
                </ConsoleSidebarNavigationIcon>
                <ConsoleSidebarNavigationContent>
                  <ConsoleSidebarNavigationItemLabel>
                    ダッシュボード
                  </ConsoleSidebarNavigationItemLabel>
                  <ConsoleSidebarNavigationItemDescription>
                    概況
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
      screen.getByRole("link", { name: /ダッシュボード/u }).getAttribute("href")
    ).toBe("/");
  });
});
