// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SiteLayoutUserMenu,
  SiteLayoutUserMenuContent,
  SiteLayoutUserMenuLogout,
  SiteLayoutUserMenuMyPageLink,
  SiteLayoutUserMenuSeparator,
  SiteLayoutUserMenuTrigger,
} from "./site-layout-user-menu";

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

const renderMenu = (logoutAction = () => {}) =>
  render(
    <SiteLayoutUserMenu>
      <SiteLayoutUserMenuTrigger ariaLabel="アカウントメニュー" />
      <SiteLayoutUserMenuContent>
        <SiteLayoutUserMenuMyPageLink href="/ja/my">
          マイページ
        </SiteLayoutUserMenuMyPageLink>
        <SiteLayoutUserMenuSeparator />
        <SiteLayoutUserMenuLogout action={logoutAction} ariaLabel="ログアウト">
          ログアウト
        </SiteLayoutUserMenuLogout>
      </SiteLayoutUserMenuContent>
    </SiteLayoutUserMenu>
  );

afterEach(cleanup);

describe("SiteLayoutUserMenu slots", () => {
  it("opening it shows the my-page and sign-out links", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "アカウントメニュー" }));

    expect(
      screen.getByRole("menuitem", { name: "マイページ" }).getAttribute("href")
    ).toBe("/ja/my");
    expect(screen.getByRole("menuitem", { name: "ログアウト" })).toBeTruthy();
  });

  it("the sign-out slot carries the Server Action form", () => {
    const logoutAction = vi.fn();
    renderMenu(logoutAction);
    fireEvent.click(screen.getByRole("button", { name: "アカウントメニュー" }));

    const logout = screen.getByRole("menuitem", { name: "ログアウト" });
    const form = logout.closest("form");
    expect(form).toBeTruthy();
    if (form) {
      fireEvent.submit(form);
    }
    expect(logoutAction).toHaveBeenCalledOnce();
  });
});
