// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConsoleUserMenu } from "./console-user-menu";

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

const renderMenu = (name = "青枝 花子") =>
  render(
    <ConsoleUserMenu
      accountHref="/settings/account"
      logoutAction={() => {}}
      name={name}
      publicId="user_admin_001"
      roleLabel="テナント管理者"
    />
  );

const openMenu = () => {
  fireEvent.click(screen.getByRole("button", { name: /アカウントメニュー/u }));
};

afterEach(() => {
  cleanup();
});

describe("ConsoleUserMenu", () => {
  it("開くまでアカウント設定とログアウトを出さない", () => {
    renderMenu();

    expect(
      screen.queryByRole("menuitem", { name: "アカウント設定" })
    ).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "ログアウト" })).toBeNull();
  });

  it("開くと氏名・public ID・役割を出す", () => {
    renderMenu();
    openMenu();

    expect(screen.getByText("青枝 花子")).toBeDefined();
    expect(screen.getByText("user_admin_001")).toBeDefined();
    expect(screen.getByText("テナント管理者")).toBeDefined();
  });

  it("アカウント設定への導線を持つ", () => {
    renderMenu();
    openMenu();

    const link = screen.getByRole("menuitem", { name: "アカウント設定" });
    expect(link.getAttribute("href")).toBe("/settings/account");
  });

  it("ログアウトを送信するとアクションを呼ぶ", () => {
    const logoutAction = vi.fn();
    render(
      <ConsoleUserMenu
        accountHref="/settings/account"
        logoutAction={logoutAction}
        name="青枝 花子"
        publicId="user_admin_001"
        roleLabel="テナント管理者"
      />
    );
    openMenu();

    const logout = screen.getByRole("menuitem", { name: "ログアウト" });
    expect(logout.getAttribute("type")).toBe("submit");

    const form = logout.closest("form");
    expect(form).not.toBeNull();
    if (form) {
      fireEvent.submit(form);
    }

    expect(logoutAction).toHaveBeenCalledTimes(1);
  });

  it("氏名の頭文字をアバターに出す", () => {
    renderMenu("hanako aoeda");

    expect(
      screen.getByRole("button", { name: /アカウントメニュー/u }).textContent
    ).toBe("H");
  });
});
