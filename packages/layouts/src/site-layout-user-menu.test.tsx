// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SiteLayoutUserMenu,
  SiteLayoutUserMenuAccount,
  SiteLayoutUserMenuAnnouncementsLink,
  SiteLayoutUserMenuContent,
  SiteLayoutUserMenuLogout,
  SiteLayoutUserMenuLogoutButton,
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
      <SiteLayoutUserMenuTrigger aria-label="Account menu" />
      <SiteLayoutUserMenuContent>
        <SiteLayoutUserMenuAccount>Reader One</SiteLayoutUserMenuAccount>
        <SiteLayoutUserMenuSeparator />
        <SiteLayoutUserMenuMyPageLink href="/en/my">
          My Page
        </SiteLayoutUserMenuMyPageLink>
        <SiteLayoutUserMenuAnnouncementsLink href="/en/announcements">
          Announcements
        </SiteLayoutUserMenuAnnouncementsLink>
        <SiteLayoutUserMenuSeparator />
        <SiteLayoutUserMenuLogout action={logoutAction}>
          <SiteLayoutUserMenuLogoutButton>
            Sign out
          </SiteLayoutUserMenuLogoutButton>
        </SiteLayoutUserMenuLogout>
      </SiteLayoutUserMenuContent>
    </SiteLayoutUserMenu>
  );

afterEach(cleanup);

describe("SiteLayoutUserMenu slots", () => {
  it("opening it shows the my-page, announcements, and sign-out links", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Account menu" }));

    expect(
      screen.getByRole("menuitem", { name: "My Page" }).getAttribute("href")
    ).toBe("/en/my");
    expect(
      screen
        .getByRole("menuitem", { name: "Announcements" })
        .getAttribute("href")
    ).toBe("/en/announcements");
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeTruthy();
  });

  it("names the account the menu belongs to, without offering it as an item", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Account menu" }));

    expect(screen.getByText("Reader One")).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Reader One" })).toBeNull();
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

  it("the trigger shows a person glyph until it is given what to show", () => {
    renderMenu();

    const trigger = screen.getByRole("button", { name: "Account menu" });
    expect(trigger.querySelector("svg")).toBeTruthy();
  });

  it("the trigger shows the account's own icon in place of the glyph", () => {
    render(
      <SiteLayoutUserMenu>
        <SiteLayoutUserMenuTrigger aria-label="Account menu">
          <span data-account-icon="reader-one" />
        </SiteLayoutUserMenuTrigger>
      </SiteLayoutUserMenu>
    );

    const trigger = screen.getByRole("button", { name: "Account menu" });
    expect(trigger.querySelector("[data-account-icon]")).toBeTruthy();
    expect(trigger.querySelector("svg")).toBeNull();
  });
});
