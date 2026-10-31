// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as ConsoleUserMenu from ".";

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
    <ConsoleUserMenu.Root>
      <ConsoleUserMenu.Trigger aria-label="Account menu for Taylor Morgan">
        <ConsoleUserMenu.Initial>Taylor Morgan</ConsoleUserMenu.Initial>
      </ConsoleUserMenu.Trigger>
      <ConsoleUserMenu.Content>
        <ConsoleUserMenu.Identity>
          <ConsoleUserMenu.Name>Taylor Morgan</ConsoleUserMenu.Name>
          <ConsoleUserMenu.PublicId>user_admin_001</ConsoleUserMenu.PublicId>
          <ConsoleUserMenu.Role>Tenant administrator</ConsoleUserMenu.Role>
        </ConsoleUserMenu.Identity>
        <ConsoleUserMenu.Separator />
        <ConsoleUserMenu.AccountLink href="/settings/account">
          Account settings
        </ConsoleUserMenu.AccountLink>
        <ConsoleUserMenu.Logout action={logoutAction}>
          <ConsoleUserMenu.LogoutButton>Sign out</ConsoleUserMenu.LogoutButton>
        </ConsoleUserMenu.Logout>
      </ConsoleUserMenu.Content>
    </ConsoleUserMenu.Root>
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
