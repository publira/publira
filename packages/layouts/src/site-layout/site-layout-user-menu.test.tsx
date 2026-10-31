// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as SiteLayout from ".";

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
    <SiteLayout.UserMenu>
      <SiteLayout.UserMenuTrigger aria-label="Account menu" />
      <SiteLayout.UserMenuContent>
        <SiteLayout.UserMenuAccount>Reader One</SiteLayout.UserMenuAccount>
        <SiteLayout.UserMenuSeparator />
        <SiteLayout.UserMenuMyPageLink href="/en/my">
          My Page
        </SiteLayout.UserMenuMyPageLink>
        <SiteLayout.UserMenuAnnouncementsLink href="/en/announcements">
          Announcements
        </SiteLayout.UserMenuAnnouncementsLink>
        <SiteLayout.UserMenuSeparator />
        <SiteLayout.UserMenuLogout action={logoutAction}>
          <SiteLayout.UserMenuLogoutButton>
            Sign out
          </SiteLayout.UserMenuLogoutButton>
        </SiteLayout.UserMenuLogout>
      </SiteLayout.UserMenuContent>
    </SiteLayout.UserMenu>
  );

afterEach(cleanup);

describe("SiteLayout.UserMenu slots", () => {
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
      <SiteLayout.UserMenu>
        <SiteLayout.UserMenuTrigger aria-label="Account menu">
          <span data-account-icon="reader-one" />
        </SiteLayout.UserMenuTrigger>
      </SiteLayout.UserMenu>
    );

    const trigger = screen.getByRole("button", { name: "Account menu" });
    expect(trigger.querySelector("[data-account-icon]")).toBeTruthy();
    expect(trigger.querySelector("svg")).toBeNull();
  });
});
