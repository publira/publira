// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { NotificationItem } from "../notification-types";
import { NotificationManager } from "./notification-manager";

vi.mock("next/link", () => ({
  default: ({ children, href }: React.ComponentProps<"a">) => (
    <a href={href}>{children}</a>
  ),
}));

const notification = (id: string): NotificationItem => ({
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

describe("NotificationManager", () => {
  it("最初のページが空なら未登録として案内する", () => {
    render(
      <NotificationManager
        notifications={[]}
        pageSize={20}
        timeZone="Asia/Tokyo"
      />
    );

    expect(screen.getByText("通知がまだありません。")).toBeDefined();
    expect(screen.queryByLabelText("通知一覧のページ送り")).toBeNull();
  });

  it("ページ送りの先が空でも一覧全体が空だとは案内しない", () => {
    render(
      <NotificationManager
        notifications={[]}
        pageSize={20}
        previousHref="?token=previous"
        timeZone="Asia/Tokyo"
      />
    );

    expect(
      screen.getByText("このページに表示できる通知はありません。")
    ).toBeDefined();
    // 復旧用のリンクは残す。ここを隠すと一覧へ戻る手段が無くなる。
    const previous = screen.getByRole("link", { name: "前へ" });
    expect(previous.getAttribute("href")).toBe("?token=previous");
    expect(screen.queryByRole("link", { name: "次へ" })).toBeNull();
  });

  it("後続ページでも行とページ送りを描画する", () => {
    render(
      <NotificationManager
        nextHref="?token=next"
        notifications={[notification("n1")]}
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
      <NotificationManager
        listErrorMessage="通知一覧を取得できませんでした。"
        nextHref="?token=next"
        notifications={[]}
        pageSize={20}
        previousHref="?token=previous"
        timeZone="Asia/Tokyo"
      />
    );

    // 取得失敗はセクションの失敗なので、他画面と同じ `SectionError`
    // （role="alert" と「〇〇一覧を表示できませんでした」）で出す。
    const sectionError = screen.getByRole("alert");
    expect(sectionError.textContent).toContain(
      "通知一覧を表示できませんでした"
    );
    expect(sectionError.textContent).toContain(
      "通知一覧を取得できませんでした。"
    );
    expect(screen.queryByText("通知がまだありません。")).toBeNull();
    expect(
      screen.queryByText("このページに表示できる通知はありません。")
    ).toBeNull();
    expect(screen.queryByLabelText("通知一覧のページ送り")).toBeNull();
  });

  it("作成日時をテナントタイムゾーンの壁時計で表示する", () => {
    render(
      <NotificationManager
        notifications={[notification("n1")]}
        pageSize={20}
        timeZone="America/Los_Angeles"
      />
    );

    // 2026-06-01T00:00:00Z is 17:00 the previous calendar day in PDT.
    expect(screen.getByText("2026/05/31 17:00")).toBeDefined();
    expect(screen.queryByText("2026/06/01 9:00")).toBeNull();
  });
});
