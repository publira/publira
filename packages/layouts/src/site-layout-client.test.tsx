// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SiteLayout, SiteLayoutHeader } from "./site-layout";
import {
  SiteLayoutMobileNavigation,
  SiteLayoutMobileNavigationActions,
  SiteLayoutMobileNavigationCloseButton,
  SiteLayoutMobileNavigationDisclosure,
  SiteLayoutMobileNavigationDisclosurePanel,
  SiteLayoutMobileNavigationDisclosureTrigger,
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
          </SiteLayoutMobileNavigationLinks>
          <SiteLayoutMobileNavigationDisclosure>
            <SiteLayoutMobileNavigationDisclosureTrigger>
              Language
            </SiteLayoutMobileNavigationDisclosureTrigger>
            <SiteLayoutMobileNavigationDisclosurePanel>
              <SiteLayoutMobileNavigationLink
                current
                href="/en/series"
                lang="en"
              >
                English
              </SiteLayoutMobileNavigationLink>
              <SiteLayoutMobileNavigationLink href="/ja/series" lang="ja">
                Japanese
              </SiteLayoutMobileNavigationLink>
            </SiteLayoutMobileNavigationDisclosurePanel>
          </SiteLayoutMobileNavigationDisclosure>
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

const openDisclosure = () => {
  fireEvent.click(screen.getByRole("button", { name: "Language" }));
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

  it("keeps the disclosure's rows behind the one row it draws closed", () => {
    renderHeader();
    openNavigation();

    expect(screen.queryByRole("link", { name: "English" })).toBe(null);

    const trigger = screen.getByRole("button", { name: "Language" });

    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(trigger);

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("link", { name: "Japanese" })).toBeTruthy();
  });

  it("marks the disclosure's own row while the keyboard is on it", () => {
    renderHeader();
    openNavigation();

    const trigger = screen.getByRole("button", { name: "Language" });

    trigger.focus();

    expect(document.activeElement).toBe(trigger);
    // jsdom resolves no Tailwind utilities, so the ring the row is marked with
    // is only visible here as the class that declares it.
    expect(trigger.className).toContain("focus-visible:ring-2");
  });

  it("marks the link in effect and names the language it leads to", () => {
    renderHeader();
    openNavigation();
    openDisclosure();

    const option = screen.getByRole("link", { name: "English" });

    expect(option.getAttribute("aria-current")).toBe("true");
    expect(option.getAttribute("lang")).toBe("en");
    expect(
      screen.getByRole("link", { name: "Series" }).getAttribute("aria-current")
    ).toBe(null);
  });

  it("closes the drawer when a language behind the disclosure is chosen", () => {
    renderHeader();
    openNavigation();
    openDisclosure();

    fireEvent.click(screen.getByRole("link", { name: "Japanese" }));

    expect(screen.queryByRole("navigation")).toBe(null);
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

  it("wraps the popup in a viewport so swipe and scroll locking stay enabled", () => {
    renderHeader();
    openNavigation();

    const dialog = screen.getByRole("dialog");

    expect(dialog.parentElement?.role).toBe("presentation");
    expect(dialog.dataset.swipeDirection).toBe("right");
  });
});
