// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SiteLayout,
  SiteLayoutBrand,
  SiteLayoutFooter,
  SiteLayoutFooterContent,
  SiteLayoutFooterCopyright,
  SiteLayoutFooterLink,
  SiteLayoutFooterLinks,
  SiteLayoutFooterNote,
  SiteLayoutHeader,
  SiteLayoutMain,
  SiteLayoutNav,
  SiteLayoutNavLink,
} from "./site-layout";
import {
  SiteLayoutActions,
  SiteLayoutLogoutAction,
  SiteLayoutPrimaryAction,
  SiteLayoutSecondaryAction,
} from "./site-layout-actions";

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

describe("SiteLayout slots", () => {
  it("composes the brand, the navigation, and the body from child slots", () => {
    render(
      <SiteLayout>
        <SiteLayoutHeader>
          <SiteLayoutBrand href="/">青枝出版</SiteLayoutBrand>
          <SiteLayoutNav>
            <SiteLayoutNavLink href="/series">シリーズ</SiteLayoutNavLink>
          </SiteLayoutNav>
        </SiteLayoutHeader>
        <SiteLayoutMain>本文</SiteLayoutMain>
      </SiteLayout>
    );

    expect(
      screen.getByRole("link", { name: "青枝出版" }).dataset.nextLink
    ).toBe("true");
    expect(
      screen.getByRole("link", { name: "シリーズ" }).getAttribute("href")
    ).toBe("/series");
    expect(screen.getByText("本文")).toBeTruthy();
  });

  it("renders each footer area from its own child slot", () => {
    render(
      <SiteLayoutFooter>
        <SiteLayoutFooterLinks ariaLabel="フッターリンク">
          <SiteLayoutFooterLink href="/terms">利用規約</SiteLayoutFooterLink>
        </SiteLayoutFooterLinks>
        <SiteLayoutFooterContent>
          <SiteLayoutFooterNote>お知らせ</SiteLayoutFooterNote>
          <SiteLayoutFooterCopyright>© Publira</SiteLayoutFooterCopyright>
        </SiteLayoutFooterContent>
      </SiteLayoutFooter>
    );

    expect(
      screen.getByRole("navigation", { name: "フッターリンク" })
    ).toBeTruthy();
    expect(screen.getByText("お知らせ")).toBeTruthy();
    expect(screen.getByText("© Publira")).toBeTruthy();
  });

  it("renders the header actions from separate child slots", () => {
    render(
      <SiteLayoutActions>
        <SiteLayoutSecondaryAction href="/login">
          ログイン
        </SiteLayoutSecondaryAction>
        <SiteLayoutPrimaryAction href="/signup">
          はじめる
        </SiteLayoutPrimaryAction>
      </SiteLayoutActions>
    );

    expect(
      screen.getByRole("link", { name: "ログイン" }).getAttribute("href")
    ).toBe("/login");
    expect(
      screen.getByRole("link", { name: "はじめる" }).getAttribute("href")
    ).toBe("/signup");
  });

  it("only the dedicated slot receives the sign-out Server Action", () => {
    render(
      <SiteLayoutActions>
        <SiteLayoutLogoutAction action={() => {}}>
          ログアウト
        </SiteLayoutLogoutAction>
      </SiteLayoutActions>
    );

    expect(
      screen.getByRole("button", { name: "ログアウト" }).closest("form")
    ).toBeTruthy();
  });
});
