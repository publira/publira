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
          <SiteLayoutBrand href="/">Aoto Press</SiteLayoutBrand>
          <SiteLayoutNav>
            <SiteLayoutNavLink href="/series">Series</SiteLayoutNavLink>
          </SiteLayoutNav>
        </SiteLayoutHeader>
        <SiteLayoutMain>Body</SiteLayoutMain>
      </SiteLayout>
    );

    expect(
      screen.getByRole("link", { name: "Aoto Press" }).dataset.nextLink
    ).toBe("true");
    expect(
      screen.getByRole("link", { name: "Series" }).getAttribute("href")
    ).toBe("/series");
    expect(screen.getByText("Body")).toBeTruthy();
  });

  it("renders each footer area from its own child slot", () => {
    render(
      <SiteLayoutFooter>
        <SiteLayoutFooterLinks ariaLabel="Footer links">
          <SiteLayoutFooterLink href="/terms">
            Terms of service
          </SiteLayoutFooterLink>
        </SiteLayoutFooterLinks>
        <SiteLayoutFooterContent>
          <SiteLayoutFooterNote>Notice</SiteLayoutFooterNote>
          <SiteLayoutFooterCopyright>© Publira</SiteLayoutFooterCopyright>
        </SiteLayoutFooterContent>
      </SiteLayoutFooter>
    );

    expect(
      screen.getByRole("navigation", { name: "Footer links" })
    ).toBeTruthy();
    expect(screen.getByText("Notice")).toBeTruthy();
    expect(screen.getByText("© Publira")).toBeTruthy();
  });

  it("renders the header actions from separate child slots", () => {
    render(
      <SiteLayoutActions>
        <SiteLayoutSecondaryAction href="/login">
          Sign in
        </SiteLayoutSecondaryAction>
        <SiteLayoutPrimaryAction href="/signup">
          Get started
        </SiteLayoutPrimaryAction>
      </SiteLayoutActions>
    );

    expect(
      screen.getByRole("link", { name: "Sign in" }).getAttribute("href")
    ).toBe("/login");
    expect(
      screen.getByRole("link", { name: "Get started" }).getAttribute("href")
    ).toBe("/signup");
  });

  it("only the dedicated slot receives the sign-out Server Action", () => {
    render(
      <SiteLayoutActions>
        <SiteLayoutLogoutAction action={() => {}}>
          Sign out
        </SiteLayoutLogoutAction>
      </SiteLayoutActions>
    );

    expect(
      screen.getByRole("button", { name: "Sign out" }).closest("form")
    ).toBeTruthy();
  });
});
