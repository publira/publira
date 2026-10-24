// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
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

afterEach(cleanup);

describe("SiteLayout slots", () => {
  it("composes the brand, the navigation, and the body from child slots", () => {
    render(
      <SiteLayout.Root>
        <SiteLayout.Header>
          <SiteLayout.Brand href="/">Aoto Press</SiteLayout.Brand>
          <SiteLayout.Nav>
            <SiteLayout.NavLink href="/series">Series</SiteLayout.NavLink>
          </SiteLayout.Nav>
        </SiteLayout.Header>
        <SiteLayout.Main>Body</SiteLayout.Main>
      </SiteLayout.Root>
    );

    expect(
      screen.getByRole("link", { name: "Aoto Press" }).dataset.nextLink
    ).toBe("true");
    expect(
      screen.getByRole("link", { name: "Series" }).getAttribute("href")
    ).toBe("/series");
    expect(screen.getByText("Body")).toBeTruthy();
  });

  it("adds the caller's classes to the header band without dropping its own", () => {
    render(
      <SiteLayout.Header className="absolute top-0">
        <SiteLayout.Brand href="/">Aoto Press</SiteLayout.Brand>
      </SiteLayout.Header>
    );

    const header = screen.getByRole("banner");
    expect(header.className).toContain("border-b");
    expect(header.className).toContain("absolute top-0");
  });

  it("renders each footer area from its own child slot", () => {
    render(
      <SiteLayout.Footer>
        <SiteLayout.FooterLinks aria-label="Footer links">
          <SiteLayout.FooterLink href="/terms">
            Terms of service
          </SiteLayout.FooterLink>
        </SiteLayout.FooterLinks>
        <SiteLayout.FooterContent>
          <SiteLayout.FooterNote>Notice</SiteLayout.FooterNote>
          <SiteLayout.FooterCopyright>© Publira</SiteLayout.FooterCopyright>
        </SiteLayout.FooterContent>
      </SiteLayout.Footer>
    );

    expect(
      screen.getByRole("navigation", { name: "Footer links" })
    ).toBeTruthy();
    expect(screen.getByText("Notice")).toBeTruthy();
    expect(screen.getByText("© Publira")).toBeTruthy();
  });

  it("renders the header actions from separate child slots", () => {
    render(
      <SiteLayout.Actions>
        <SiteLayout.SecondaryAction href="/login">
          Sign in
        </SiteLayout.SecondaryAction>
        <SiteLayout.PrimaryAction href="/signup">
          Get started
        </SiteLayout.PrimaryAction>
      </SiteLayout.Actions>
    );

    expect(
      screen.getByRole("link", { name: "Sign in" }).getAttribute("href")
    ).toBe("/login");
    expect(
      screen.getByRole("link", { name: "Get started" }).getAttribute("href")
    ).toBe("/signup");
  });
});

describe("SiteLayout.NavSkeleton", () => {
  it("stands in for the navigation without naming a link", () => {
    render(<SiteLayout.NavSkeleton />);

    // The whole point of the stand-in: an href the caller cannot name yet is
    // not rendered as a link a reader could follow.
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});
