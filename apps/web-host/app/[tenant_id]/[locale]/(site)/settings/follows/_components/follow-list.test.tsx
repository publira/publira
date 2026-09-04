// @vitest-environment jsdom

import { sharedCatalog } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FollowListItem } from "#lib/follow-list";

import { FollowList } from "./follow-list";

vi.mock("#components/locale-provider", () => ({
  useLocale: () => "en",
  useTenantDefaultLocale: () => "en",
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: string;
  } & ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// `getLocale()` reads `next/root-params`, which only the Next.js compiler can
// provide. The catalog is the real one, so the assertions stay on the copy a
// reader actually sees.
vi.mock("#lib/locale", () => ({
  getLocale: () => Promise.resolve("en"),
  loadHostMessages: () => Promise.resolve(sharedCatalog("en")),
}));

vi.mock("./unfollow-button", () => ({
  UnfollowButton: ({
    copy,
    publicId,
  }: {
    copy: { ariaLabel: string };
    publicId: string;
  }) => <button type="button">{`${copy.ariaLabel} ${publicId}`}</button>,
}));

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const follow = (overrides: Partial<FollowListItem> = {}): FollowListItem => ({
  followedAt: "2026-06-01T00:00:00Z",
  href: "/series/SERIES01",
  publicId: "SERIES01",
  targetKind: "series",
  title: "Published Series",
  unavailable: false,
  ...overrides,
});

/**
 * The component is an async Server Component, which the client renderer cannot
 * mount on its own: awaiting it here hands `render` the element tree it
 * produced.
 */
const renderList = async (
  props: Partial<ComponentProps<typeof FollowList>> = {}
) => {
  const list = await FollowList({
    items: [],
    nextToken: "",
    previousToken: "",
    tenantId,
    timeZone: "Asia/Tokyo",
    token: "",
    ...props,
  });
  render(list);
};

afterEach(() => {
  cleanup();
});

describe("FollowList", () => {
  it("If the first page is empty, you will be marked as unfollowed.", async () => {
    await renderList();

    expect(
      screen.getByText("You are not following any series or authors.")
    ).toBeDefined();
    expect(
      screen.getByText(
        /Anything that stops being published drops off the list/u
      )
    ).toBeDefined();
    expect(screen.queryByLabelText("Follows pagination")).toBeNull();
    expect(
      screen.getByRole("link", { name: "Browse series" }).getAttribute("href")
    ).toBe("/series");
  });

  it("Even if the destination of the page is empty, it will not notify you that the entire list is empty.", async () => {
    await renderList({ previousToken: "previous", token: "current" });

    expect(
      screen.getByText("There are no follows on this page.")
    ).toBeDefined();
    const previous = screen.getByRole("link", { name: "Previous page" });
    expect(previous.getAttribute("href")).toBe(
      "/settings/follows?token=previous"
    );
  });

  it("Draw links to public pages for works and authors and undo operations", async () => {
    await renderList({
      items: [
        follow(),
        follow({
          followedAt: "2026-05-31T00:00:00Z",
          href: "/authors/AUTHOR01",
          publicId: "AUTHOR01",
          targetKind: "author",
          title: "Published Author",
        }),
      ],
      nextToken: "next",
      previousToken: "previous",
    });

    const seriesLink = screen.getByRole("link", { name: "Published Series" });
    expect(seriesLink.getAttribute("href")).toBe("/series/SERIES01");
    const authorLink = screen.getByRole("link", { name: "Published Author" });
    expect(authorLink.getAttribute("href")).toBe("/authors/AUTHOR01");
    expect(screen.getByText("Series")).toBeDefined();
    expect(screen.getByText("Author")).toBeDefined();
    expect(screen.getByText("Jun 1, 2026, 9:00 AM")).toBeDefined();
    expect(
      screen.getByText("Unfollow Published Series SERIES01")
    ).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Previous page" }).getAttribute("href")
    ).toBe("/settings/follows?token=previous");
    expect(
      screen.getByRole("link", { name: "Next page" }).getAttribute("href")
    ).toBe("/settings/follows?token=next");
  });

  it("Targets that have been made private cannot be linked or deleted.", async () => {
    await renderList({
      items: [
        follow({
          href: undefined,
          title: "Not currently published",
          unavailable: true,
        }),
      ],
    });

    expect(screen.getByText("Not currently published")).toBeDefined();
    expect(
      screen.queryByRole("link", { name: "Not currently published" })
    ).toBeNull();
    expect(
      screen.queryByText("Unfollow Not currently published SERIES01")
    ).toBeNull();
  });

  it("If acquisition fails, only an error will be displayed and an empty list will not be displayed.", async () => {
    await renderList({
      listErrorMessage: "Could not load your follows.",
      nextToken: "next",
      previousToken: "previous",
    });

    const sectionError = screen.getByRole("alert");
    expect(sectionError.textContent).toContain(
      "Could not display your follows"
    );
    expect(sectionError.textContent).toContain("Could not load your follows.");
    expect(
      screen.queryByText("You are not following any series or authors.")
    ).toBeNull();
    expect(screen.queryByLabelText("Follows pagination")).toBeNull();
  });
});
