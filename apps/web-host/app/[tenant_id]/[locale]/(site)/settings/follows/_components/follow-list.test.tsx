// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FollowListItem } from "#lib/follow-list";

import { FollowList } from "./follow-list";

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

vi.mock("./unfollow-button", () => ({
  UnfollowButton: ({
    publicId,
    targetName,
  }: {
    publicId: string;
    targetName: string;
  }) => (
    <button type="button">{`「${targetName}」のフォローを解除する ${publicId}`}</button>
  ),
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

afterEach(() => {
  cleanup();
});

describe("FollowList", () => {
  it("最初のページが空なら未フォローとして案内する", () => {
    render(
      <FollowList
        items={[]}
        nextToken=""
        previousToken=""
        tenantId={tenantId}
        timeZone="Asia/Tokyo"
        token=""
      />
    );

    expect(
      screen.getByText("フォロー中の作品・著者はありません。")
    ).toBeDefined();
    expect(
      screen.getByText(/非公開になった対象は一覧から外れます/u)
    ).toBeDefined();
    expect(screen.queryByLabelText("フォロー一覧ページング")).toBeNull();
    expect(
      screen.getByRole("link", { name: "シリーズを探す" }).getAttribute("href")
    ).toBe("/ja/series");
  });

  it("ページ送りの先が空でも一覧全体が空だとは案内しない", () => {
    render(
      <FollowList
        items={[]}
        nextToken=""
        previousToken="previous"
        tenantId={tenantId}
        timeZone="Asia/Tokyo"
        token="current"
      />
    );

    expect(
      screen.getByText("このページに表示できるフォローはありません。")
    ).toBeDefined();
    const previous = screen.getByRole("link", { name: "前のページ" });
    expect(previous.getAttribute("href")).toBe(
      "/ja/settings/follows?token=previous"
    );
  });

  it("作品と著者の公開ページへのリンクと解除操作を描画する", () => {
    render(
      <FollowList
        items={[
          follow(),
          follow({
            followedAt: "2026-05-31T00:00:00Z",
            href: "/authors/AUTHOR01",
            publicId: "AUTHOR01",
            targetKind: "author",
            title: "公開著者",
          }),
        ]}
        nextToken="next"
        previousToken="previous"
        tenantId={tenantId}
        timeZone="Asia/Tokyo"
        token=""
      />
    );

    const seriesLink = screen.getByRole("link", { name: "公開シリーズ" });
    expect(seriesLink.getAttribute("href")).toBe("/ja/series/SERIES01");
    const authorLink = screen.getByRole("link", { name: "公開著者" });
    expect(authorLink.getAttribute("href")).toBe("/ja/authors/AUTHOR01");
    expect(screen.getByText("作品")).toBeDefined();
    expect(screen.getByText("著者")).toBeDefined();
    expect(screen.getByText("2026/06/01 9:00")).toBeDefined();
    expect(
      screen.getByText("「公開シリーズ」のフォローを解除する SERIES01")
    ).toBeDefined();
    expect(
      screen.getByRole("link", { name: "前のページ" }).getAttribute("href")
    ).toBe("/ja/settings/follows?token=previous");
    expect(
      screen.getByRole("link", { name: "次のページ" }).getAttribute("href")
    ).toBe("/ja/settings/follows?token=next");
  });

  it("非公開になった対象はリンクも解除も出さない", () => {
    render(
      <FollowList
        items={[
          follow({
            href: undefined,
            title: "現在公開されていません",
            unavailable: true,
          }),
        ]}
        nextToken=""
        previousToken=""
        tenantId={tenantId}
        timeZone="Asia/Tokyo"
        token=""
      />
    );

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

  it("取得失敗時はエラーだけを出し、空一覧としては案内しない", () => {
    render(
      <FollowList
        items={[]}
        listErrorMessage="フォロー一覧を取得できませんでした。"
        nextToken="next"
        previousToken="previous"
        tenantId={tenantId}
        timeZone="Asia/Tokyo"
        token=""
      />
    );

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
