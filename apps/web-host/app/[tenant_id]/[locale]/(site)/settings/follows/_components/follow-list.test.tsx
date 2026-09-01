// @vitest-environment jsdom

import { sharedCatalog } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FollowListItem } from "#lib/follow-list";

import { FollowList } from "./follow-list";

vi.mock("#components/locale-provider", () => ({
  useLocale: () => "ja",
  useTenantDefaultLocale: () => "ja",
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
  getLocale: () => Promise.resolve("ja"),
  loadHostMessages: () => Promise.resolve(sharedCatalog("ja")),
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
  title: "公開シリーズ",
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
      screen.getByText("フォロー中の作品・著者はありません。")
    ).toBeDefined();
    expect(
      screen.getByText(/非公開になった対象は一覧から外れます/u)
    ).toBeDefined();
    expect(screen.queryByLabelText("フォロー一覧ページング")).toBeNull();
    expect(
      screen.getByRole("link", { name: "シリーズを探す" }).getAttribute("href")
    ).toBe("/series");
  });

  it("Even if the destination of the page is empty, it will not notify you that the entire list is empty.", async () => {
    await renderList({ previousToken: "previous", token: "current" });

    expect(
      screen.getByText("このページに表示できるフォローはありません。")
    ).toBeDefined();
    const previous = screen.getByRole("link", { name: "前のページ" });
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
          title: "公開著者",
        }),
      ],
      nextToken: "next",
      previousToken: "previous",
    });

    const seriesLink = screen.getByRole("link", { name: "公開シリーズ" });
    expect(seriesLink.getAttribute("href")).toBe("/series/SERIES01");
    const authorLink = screen.getByRole("link", { name: "公開著者" });
    expect(authorLink.getAttribute("href")).toBe("/authors/AUTHOR01");
    expect(screen.getByText("作品")).toBeDefined();
    expect(screen.getByText("著者")).toBeDefined();
    expect(screen.getByText("2026/06/01 9:00")).toBeDefined();
    expect(
      screen.getByText("「公開シリーズ」のフォローを解除する SERIES01")
    ).toBeDefined();
    expect(
      screen.getByRole("link", { name: "前のページ" }).getAttribute("href")
    ).toBe("/settings/follows?token=previous");
    expect(
      screen.getByRole("link", { name: "次のページ" }).getAttribute("href")
    ).toBe("/settings/follows?token=next");
  });

  it("Targets that have been made private cannot be linked or deleted.", async () => {
    await renderList({
      items: [
        follow({
          href: undefined,
          title: "現在公開されていません",
          unavailable: true,
        }),
      ],
    });

    expect(screen.getByText("現在公開されていません")).toBeDefined();
    expect(
      screen.queryByRole("link", { name: "現在公開されていません" })
    ).toBeNull();
    expect(
      screen.queryByText(
        "「現在公開されていません」のフォローを解除する SERIES01"
      )
    ).toBeNull();
  });

  it("If acquisition fails, only an error will be displayed and an empty list will not be displayed.", async () => {
    await renderList({
      listErrorMessage: "フォロー一覧を取得できませんでした。",
      nextToken: "next",
      previousToken: "previous",
    });

    const sectionError = screen.getByRole("alert");
    expect(sectionError.textContent).toContain(
      "フォロー一覧を表示できませんでした"
    );
    expect(sectionError.textContent).toContain(
      "フォロー一覧を取得できませんでした。"
    );
    expect(
      screen.queryByText("フォロー中の作品・著者はありません。")
    ).toBeNull();
    expect(screen.queryByLabelText("フォロー一覧ページング")).toBeNull();
  });
});
