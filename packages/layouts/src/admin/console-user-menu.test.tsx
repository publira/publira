// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ConsoleHeaderUser,
  ConsoleUserMenuAccountLink,
  ConsoleUserMenuContent,
  ConsoleUserMenuIdentity,
  ConsoleUserMenuInitial,
  ConsoleUserMenuLogout,
  ConsoleUserMenuName,
  ConsoleUserMenuPublicId,
  ConsoleUserMenuRole,
  ConsoleUserMenuSeparator,
  ConsoleUserMenuTrigger,
} from "./console-user-menu";

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
    <ConsoleHeaderUser>
      <ConsoleUserMenuTrigger ariaLabel="青枝 花子のアカウントメニュー">
        <ConsoleUserMenuInitial>青枝 花子</ConsoleUserMenuInitial>
      </ConsoleUserMenuTrigger>
      <ConsoleUserMenuContent>
        <ConsoleUserMenuIdentity>
          <ConsoleUserMenuName>青枝 花子</ConsoleUserMenuName>
          <ConsoleUserMenuPublicId>user_admin_001</ConsoleUserMenuPublicId>
          <ConsoleUserMenuRole>テナント管理者</ConsoleUserMenuRole>
        </ConsoleUserMenuIdentity>
        <ConsoleUserMenuSeparator />
        <ConsoleUserMenuAccountLink href="/settings/account">
          アカウント設定
        </ConsoleUserMenuAccountLink>
        <ConsoleUserMenuLogout action={logoutAction} ariaLabel="ログアウト">
          ログアウト
        </ConsoleUserMenuLogout>
      </ConsoleUserMenuContent>
    </ConsoleHeaderUser>
  );

afterEach(cleanup);

describe("ConsoleUserMenu slots", () => {
  it("開くと子スロットの識別情報とアクションを表示する", () => {
    renderMenu();
    fireEvent.click(
      screen.getByRole("button", { name: /アカウントメニュー/u })
    );

    expect(screen.getByText("青枝 花子")).toBeTruthy();
    expect(screen.getByText("user_admin_001")).toBeTruthy();
    expect(screen.getByText("テナント管理者")).toBeTruthy();
    expect(
      screen
        .getByRole("menuitem", { name: "アカウント設定" })
        .getAttribute("href")
    ).toBe("/settings/account");
  });

  it("ログアウト用スロットが Server Action の form を持つ", () => {
    const logoutAction = vi.fn();
    renderMenu(logoutAction);
    fireEvent.click(
      screen.getByRole("button", { name: /アカウントメニュー/u })
    );

    const logout = screen.getByRole("menuitem", { name: "ログアウト" });
    const form = logout.closest("form");
    expect(form).toBeTruthy();
    if (form) {
      fireEvent.submit(form);
    }
    expect(logoutAction).toHaveBeenCalledOnce();
  });
});
