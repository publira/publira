// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SiteLayout, SiteLayoutHeader } from "./site-layout";
import {
  SiteLayoutMobileNavigation,
  SiteLayoutMobileNavigationActions,
  SiteLayoutMobileNavigationCloseButton,
  SiteLayoutMobileNavigationHeader,
  SiteLayoutMobileNavigationLink,
  SiteLayoutMobileNavigationLinks,
  SiteLayoutMobileNavigationOpenButton,
  SiteLayoutMobileNavigationPrimaryAction,
  SiteLayoutMobileNavigationSearch,
  SiteLayoutMobileNavigationSecondaryAction,
  SiteLayoutMobileNavigationTitle,
} from "./site-layout-client";

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

const renderHeader = () =>
  render(
    <SiteLayout>
      <SiteLayoutHeader>
        <SiteLayoutMobileNavigation>
          <SiteLayoutMobileNavigationHeader>
            <SiteLayoutMobileNavigationTitle>
              Menu
            </SiteLayoutMobileNavigationTitle>
            <SiteLayoutMobileNavigationCloseButton aria-label="Close navigation" />
          </SiteLayoutMobileNavigationHeader>
          <SiteLayoutMobileNavigationSearch>
            <form action="/search">
              <label htmlFor="q">Search works</label>
              <input id="q" name="q" type="search" />
              <button type="submit">Search</button>
            </form>
          </SiteLayoutMobileNavigationSearch>
          <SiteLayoutMobileNavigationLinks>
            <SiteLayoutMobileNavigationLink href="/series">
              Series
            </SiteLayoutMobileNavigationLink>
            <SiteLayoutMobileNavigationLink current href="/en/series" lang="en">
              English
            </SiteLayoutMobileNavigationLink>
          </SiteLayoutMobileNavigationLinks>
          <SiteLayoutMobileNavigationActions>
            <SiteLayoutMobileNavigationSecondaryAction href="/login">
              Sign in
            </SiteLayoutMobileNavigationSecondaryAction>
            <SiteLayoutMobileNavigationPrimaryAction href="/signup">
              Get started
            </SiteLayoutMobileNavigationPrimaryAction>
          </SiteLayoutMobileNavigationActions>
        </SiteLayoutMobileNavigation>
        <SiteLayoutMobileNavigationOpenButton aria-label="Open navigation" />
      </SiteLayoutHeader>
    </SiteLayout>
  );

const openNavigation = () => {
  fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
};

describe("Site mobile navigation", () => {
  it("holds the controls the band stops drawing at a phone width", () => {
    renderHeader();

    expect(screen.queryByRole("navigation")).toBe(null);

    openNavigation();

    expect(screen.getByRole("navigation")).toBeTruthy();
    expect(
      screen.getByRole("searchbox", { name: "Search works" })
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Sign in" }).getAttribute("href")
    ).toBe("/login");
    expect(
      screen.getByRole("link", { name: "Get started" }).getAttribute("href")
    ).toBe("/signup");
  });

  it("marks the link in effect and names the language it leads to", () => {
    renderHeader();
    openNavigation();

    const option = screen.getByRole("link", { name: "English" });

    expect(option.getAttribute("aria-current")).toBe("true");
    expect(option.getAttribute("lang")).toBe("en");
    expect(
      screen.getByRole("link", { name: "Series" }).getAttribute("aria-current")
    ).toBe(null);
  });

  it("closes when a link inside it is followed", () => {
    renderHeader();
    openNavigation();

    fireEvent.click(screen.getByRole("link", { name: "Series" }));

    expect(screen.queryByRole("navigation")).toBe(null);
  });

  it("closes when the search field is submitted", () => {
    renderHeader();
    openNavigation();

    fireEvent.submit(screen.getByRole("searchbox", { name: "Search works" }));

    expect(screen.queryByRole("navigation")).toBe(null);
  });

  it("closes from its own close button", () => {
    renderHeader();
    openNavigation();

    fireEvent.click(screen.getByRole("button", { name: "Close navigation" }));

    expect(screen.queryByRole("navigation")).toBe(null);
  });
});
