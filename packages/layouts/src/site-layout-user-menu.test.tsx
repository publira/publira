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
      <SiteLayoutUserMenuTrigger ariaLabel="Account menu" />
      <SiteLayoutUserMenuContent>
        <SiteLayoutUserMenuMyPageLink href="/en/my">
          My Page
        </SiteLayoutUserMenuMyPageLink>
        <SiteLayoutUserMenuSeparator />
        <SiteLayoutUserMenuLogout action={logoutAction} ariaLabel="Sign out">
          Sign out
        </SiteLayoutUserMenuLogout>
      </SiteLayoutUserMenuContent>
    </SiteLayoutUserMenu>
  );

afterEach(cleanup);

describe("SiteLayoutUserMenu slots", () => {
  it("opening it shows the my-page and sign-out links", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Account menu" }));

    expect(
      screen.getByRole("menuitem", { name: "My Page" }).getAttribute("href")
    ).toBe("/en/my");
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeTruthy();
  });

  it("the sign-out slot carries the Server Action form", () => {
    const logoutAction = vi.fn();
    renderMenu(logoutAction);
    fireEvent.click(screen.getByRole("button", { name: "Account menu" }));

    const logout = screen.getByRole("menuitem", { name: "Sign out" });
    const form = logout.closest("form");
    expect(form).toBeTruthy();
    if (form) {
      fireEvent.submit(form);
    }
    expect(logoutAction).toHaveBeenCalledOnce();
  });
});
