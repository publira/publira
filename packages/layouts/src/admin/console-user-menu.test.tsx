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
  ConsoleUserMenuLogoutButton,
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
      <ConsoleUserMenuTrigger aria-label="Account menu for Taylor Morgan">
        <ConsoleUserMenuInitial>Taylor Morgan</ConsoleUserMenuInitial>
      </ConsoleUserMenuTrigger>
      <ConsoleUserMenuContent>
        <ConsoleUserMenuIdentity>
          <ConsoleUserMenuName>Taylor Morgan</ConsoleUserMenuName>
          <ConsoleUserMenuPublicId>user_admin_001</ConsoleUserMenuPublicId>
          <ConsoleUserMenuRole>Tenant administrator</ConsoleUserMenuRole>
        </ConsoleUserMenuIdentity>
        <ConsoleUserMenuSeparator />
        <ConsoleUserMenuAccountLink href="/settings/account">
          Account settings
        </ConsoleUserMenuAccountLink>
        <ConsoleUserMenuLogout action={logoutAction}>
          <ConsoleUserMenuLogoutButton>Sign out</ConsoleUserMenuLogoutButton>
        </ConsoleUserMenuLogout>
      </ConsoleUserMenuContent>
    </ConsoleHeaderUser>
  );

afterEach(cleanup);

describe("ConsoleUserMenu slots", () => {
  it("renders identity and action slots when opened", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: /account menu/iu }));

    expect(screen.getByText("Taylor Morgan")).toBeTruthy();
    expect(screen.getByText("user_admin_001")).toBeTruthy();
    expect(screen.getByText("Tenant administrator")).toBeTruthy();
    expect(
      screen
        .getByRole("menuitem", { name: "Account settings" })
        .getAttribute("href")
    ).toBe("/settings/account");
  });

  it("renders the sign-out slot inside a Server Action form", () => {
    const logoutAction = vi.fn();
    renderMenu(logoutAction);
    fireEvent.click(screen.getByRole("button", { name: /account menu/iu }));

    const logout = screen.getByRole("menuitem", { name: "Sign out" });
    const form = logout.closest("form");
    expect(form).toBeTruthy();
    if (form) {
      fireEvent.submit(form);
    }
    expect(logoutAction).toHaveBeenCalledOnce();
  });
});
