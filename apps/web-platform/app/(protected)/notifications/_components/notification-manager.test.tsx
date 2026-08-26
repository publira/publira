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

vi.mock("./notification-read-actions", () => ({
  MarkAllNotificationsAsReadButton: () => (
    <button type="button">すべて既読にする</button>
  ),
  MarkNotificationAsReadButton: ({
    notificationId,
  }: {
    notificationId: string;
  }) => <button type="button">既読にする {notificationId}</button>,
}));

const notification = (
  id: string,
  overrides: Partial<NotificationItem> = {}
): NotificationItem => ({
  createdAt: "2026-06-01T00:00:00Z",
  description: "テナント「Acme」の「第1話」（作品A）を公開できませんでした。",
  href: "/tenants/SeedTNNTAAA1",
  id,
  isRead: false,
  notificationType: "episode_publish_failed",
  title: "エピソードの公開に失敗しました",
  ...overrides,
});

const copy = {
  actionColumn: "操作",
  cardDescription: "自分宛の業務イベントです。テナント詳細へ遷移できます。",
  cardTitle: "通知一覧",
  columnAt: "日時",
  columnContent: "内容",
  columnStatus: "状態",
  emptyDescription:
    "予約公開の失敗など、運営者向けの業務イベントが起きると、ここに自分宛の通知が届きます。",
  emptyPageDescription:
    "表示中に他の操作で削除された可能性があります。前後のページへ移動してください。",
  emptyPageTitle: "このページに表示できる通知はありません。",
  emptyTitle: "通知はまだありません。",
  listErrorTitle: "通知一覧を表示できませんでした",
  markAllRead: "すべて既読にする",
  markRead: "既読にする",
  markReadAriaLabel: (title: string) => `${title}を既読にする`,
  markReadPending: "更新中…",
  paginationAriaLabel: "通知一覧のページ送り",
  perPage: "新しい順に、1ページあたり 20 件まで表示します。",
  read: "既読",
  unread: "未読",
};

afterEach(() => {
  cleanup();
});

describe("NotificationManager", () => {
  it("最初のページが空なら未着として案内する", () => {
    render(
      <NotificationManager
        copy={copy}
        notifications={[]}
        nextLabel="次へ"
        previousLabel="前へ"
        timeZone="Asia/Tokyo"
        unreadCount={0}
      />
    );

    expect(screen.getByText("通知はまだありません。")).toBeDefined();
    expect(screen.queryByLabelText("通知一覧のページ送り")).toBeNull();
    expect(screen.queryByText("すべて既読にする")).toBeNull();
  });

  it("ページ送りの先が空でも一覧全体が空だとは案内しない", () => {
    render(
      <NotificationManager
        copy={copy}
        notifications={[]}
        nextLabel="次へ"
        previousHref="/notifications?token=previous"
        previousLabel="前へ"
        timeZone="Asia/Tokyo"
        unreadCount={0}
      />
    );

    expect(
      screen.getByText("このページに表示できる通知はありません。")
    ).toBeDefined();
    const previous = screen.getByRole("link", { name: "前へ" });
    expect(previous.getAttribute("href")).toBe("/notifications?token=previous");
  });

  it("未読行とリンク、既読ボタンを描画する", () => {
    render(
      <NotificationManager
        copy={copy}
        nextHref="/notifications?token=next"
        nextLabel="次へ"
        notifications={[
          notification("n1"),
          notification("n2", {
            createdAt: "2026-05-31T00:00:00Z",
            href: undefined,
            isRead: true,
            title: "通知",
          }),
        ]}
        previousHref="/notifications?token=previous"
        previousLabel="前へ"
        timeZone="Asia/Tokyo"
        unreadCount={1}
      />
    );

    const titleLink = screen.getByRole("link", {
      name: "エピソードの公開に失敗しました",
    });
    expect(titleLink.getAttribute("href")).toBe("/tenants/SeedTNNTAAA1");
    expect(screen.getByText("2026/06/01 9:00")).toBeDefined();
    expect(screen.getByText("未読")).toBeDefined();
    expect(screen.getByText("既読")).toBeDefined();
    expect(screen.getByText("既読にする n1")).toBeDefined();
    expect(screen.queryByText("既読にする n2")).toBeNull();
    expect(screen.getByText("すべて既読にする")).toBeDefined();
    expect(
      screen.getByRole("link", { name: "前へ" }).getAttribute("href")
    ).toBe("/notifications?token=previous");
    expect(
      screen.getByRole("link", { name: "次へ" }).getAttribute("href")
    ).toBe("/notifications?token=next");
  });

  it("取得失敗時はエラーだけを出し、空一覧としては案内しない", () => {
    render(
      <NotificationManager
        copy={copy}
        listErrorMessage="通知一覧を取得できませんでした。"
        nextHref="/notifications?token=next"
        notifications={[]}
        nextLabel="次へ"
        previousHref="/notifications?token=previous"
        previousLabel="前へ"
        timeZone="Asia/Tokyo"
        unreadCount={2}
      />
    );

    const sectionError = screen.getByRole("alert");
    expect(sectionError.textContent).toContain(
      "通知一覧を表示できませんでした"
    );
    expect(sectionError.textContent).toContain(
      "通知一覧を取得できませんでした。"
    );
    expect(screen.queryByText("通知はまだありません。")).toBeNull();
    expect(screen.queryByLabelText("通知一覧のページ送り")).toBeNull();
    expect(screen.queryByText("すべて既読にする")).toBeNull();
  });

  it("作成日時をプラットフォーム既定タイムゾーンの壁時計で表示する", () => {
    render(
      <NotificationManager
        copy={copy}
        notifications={[notification("n1")]}
        nextLabel="次へ"
        previousLabel="前へ"
        timeZone="America/Los_Angeles"
        unreadCount={1}
      />
    );

    expect(screen.getByText("2026/05/31 17:00")).toBeDefined();
    expect(screen.queryByText("2026/06/01 9:00")).toBeNull();
  });
});
