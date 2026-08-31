// @vitest-environment jsdom

import { getMessage } from "@publira/i18n";
import type { MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AnnouncementItem } from "../announcement-types";
import { AnnouncementManager } from "./announcement-manager";

vi.mock("#components/message", () => ({
  Message: ({ message, values }: { message: string; values?: MessageValues }) =>
    getMessage(sharedCatalog("ja"), message, values),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: React.ComponentProps<"a">) => (
    <a href={href}>{children}</a>
  ),
}));

const announcement = (id: string): AnnouncementItem => ({
  audienceType: "all",
  body: "本文",
  createdAt: "2026-06-01T00:00:00Z",
  id,
  linkUrl: "/series/S001",
  targetUserName: "",
  targetUserPublicId: "",
  title: "メンテナンスのお知らせ",
});

afterEach(() => {
  cleanup();
});

describe("AnnouncementManager", () => {
  it("最初のページが空なら未登録として案内する", () => {
    render(
      <AnnouncementManager
        announcements={[]}
        locale="ja"
        pageSize={20}
        timeZone="Asia/Tokyo"
      />
    );

    expect(screen.getByText("お知らせがまだありません。")).toBeDefined();
    expect(screen.queryByLabelText("お知らせ一覧のページ送り")).toBeNull();
  });

  it("ページ送りの先が空でも一覧全体が空だとは案内しない", () => {
    render(
      <AnnouncementManager
        announcements={[]}
        locale="ja"
        pageSize={20}
        previousHref="?token=previous"
        timeZone="Asia/Tokyo"
      />
    );

    expect(
      screen.getByText("このページに表示できるお知らせはありません。")
    ).toBeDefined();
    // 復旧用のリンクは残す。ここを隠すと一覧へ戻る手段が無くなる。
    const previous = screen.getByRole("link", { name: "前へ" });
    expect(previous.getAttribute("href")).toBe("?token=previous");
    expect(screen.queryByRole("link", { name: "次へ" })).toBeNull();
  });

  it("後続ページでも行とページ送りを描画する", () => {
    render(
      <AnnouncementManager
        nextHref="?token=next"
        announcements={[announcement("n1")]}
        locale="ja"
        pageSize={20}
        previousHref="?token=previous"
        timeZone="Asia/Tokyo"
      />
    );

    expect(screen.getByText("メンテナンスのお知らせ")).toBeDefined();
    // 2026-06-01T00:00:00Z is 09:00 the same calendar day in Asia/Tokyo.
    expect(screen.getByText("2026/06/01 9:00")).toBeDefined();
    expect(
      screen.getByRole("link", { name: "前へ" }).getAttribute("href")
    ).toBe("?token=previous");
    expect(
      screen.getByRole("link", { name: "次へ" }).getAttribute("href")
    ).toBe("?token=next");
  });

  it("取得失敗時はエラーだけを出し、空一覧としては案内しない", () => {
    render(
      <AnnouncementManager
        listErrorMessage="お知らせ一覧を取得できませんでした。"
        nextHref="?token=next"
        announcements={[]}
        locale="ja"
        pageSize={20}
        previousHref="?token=previous"
        timeZone="Asia/Tokyo"
      />
    );

    // 取得失敗はセクションの失敗なので、他画面と同じ `SectionError`
    // （role="alert" と「〇〇一覧を表示できませんでした」）で出す。
    const sectionError = screen.getByRole("alert");
    expect(sectionError.textContent).toContain(
      "お知らせ一覧を表示できませんでした"
    );
    expect(sectionError.textContent).toContain(
      "お知らせ一覧を取得できませんでした。"
    );
    expect(screen.queryByText("お知らせがまだありません。")).toBeNull();
    expect(
      screen.queryByText("このページに表示できるお知らせはありません。")
    ).toBeNull();
    expect(screen.queryByLabelText("お知らせ一覧のページ送り")).toBeNull();
  });

  it("作成日時をテナントタイムゾーンの壁時計で表示する", () => {
    render(
      <AnnouncementManager
        announcements={[announcement("n1")]}
        locale="ja"
        pageSize={20}
        timeZone="America/Los_Angeles"
      />
    );

    // 2026-06-01T00:00:00Z is 17:00 the previous calendar day in PDT.
    expect(screen.getByText("2026/05/31 17:00")).toBeDefined();
    expect(screen.queryByText("2026/06/01 9:00")).toBeNull();
  });
});
