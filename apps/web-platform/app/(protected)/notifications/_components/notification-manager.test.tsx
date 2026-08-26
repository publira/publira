// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ja from "../../../../../../locales/ja.json";
import type { NotificationItem } from "../notification-types";
import { NotificationManager } from "./notification-manager";

const notificationMessages = {
  "platform.common.next": "次へ",
  "platform.common.previous": "前へ",
  "platform.notifications.card_description":
    "自分宛の業務イベントです。テナント詳細へ遷移できます。",
  "platform.notifications.card_title": "通知一覧",
  "platform.notifications.columns.action": "操作",
  "platform.notifications.columns.at": "日時",
  "platform.notifications.columns.content": "内容",
  "platform.notifications.columns.status": "状態",
  "platform.notifications.list_failed": "通知一覧を表示できませんでした",
  "platform.notifications.mark_all_read": "すべて既読にする",
  "platform.notifications.mark_read": "既読にする",
  "platform.notifications.per_page":
    "新しい順に、1ページあたり 20 件まで表示します。",
  "platform.notifications.read": "既読",
  "platform.notifications.unread": "未読",
} as const;

vi.mock("#components/message", () => ({
  Message: ({ message }: { message: keyof typeof notificationMessages }) =>
    notificationMessages[message],
}));

vi.mock("#components/pagination-controls", () => ({
  PaginationControls: ({
    nextHref,
    previousHref,
  }: {
    nextHref?: string;
    previousHref?: string;
  }) => (
    <nav aria-label="通知一覧のページ送り">
      {previousHref ? <a href={previousHref}>前へ</a> : null}
      {nextHref ? <a href={nextHref}>次へ</a> : null}
    </nav>
  ),
}));

vi.mock("#lib/locale", () => ({
  getPlatformLocale: () => Promise.resolve("ja"),
  loadPlatformMessages: () => Promise.resolve(ja),
}));

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

afterEach(() => {
  cleanup();
});

describe("NotificationManager", () => {
  it("最初のページが空なら未着として案内する", async () => {
    render(
      await NotificationManager({
        notifications: [],
        timeZone: "Asia/Tokyo",
        unreadCount: 0,
      })
    );

    expect(screen.getByText("通知はまだありません。")).toBeDefined();
    expect(screen.queryByLabelText("通知一覧のページ送り")).toBeNull();
    expect(screen.queryByText("すべて既読にする")).toBeNull();
  });

  it("ページ送りの先が空でも一覧全体が空だとは案内しない", async () => {
    render(
      await NotificationManager({
        notifications: [],
        previousHref: "/notifications?token=previous",
        timeZone: "Asia/Tokyo",
        unreadCount: 0,
      })
    );

    expect(
      screen.getByText("このページに表示できる通知はありません。")
    ).toBeDefined();
    const previous = screen.getByRole("link", { name: "前へ" });
    expect(previous.getAttribute("href")).toBe("/notifications?token=previous");
  });

  it("未読行とリンク、既読ボタンを描画する", async () => {
    render(
      await NotificationManager({
        nextHref: "/notifications?token=next",
        notifications: [
          notification("n1"),
          notification("n2", {
            createdAt: "2026-05-31T00:00:00Z",
            href: undefined,
            isRead: true,
            title: "通知",
          }),
        ],
        previousHref: "/notifications?token=previous",
        timeZone: "Asia/Tokyo",
        unreadCount: 1,
      })
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

  it("取得失敗時はエラーだけを出し、空一覧としては案内しない", async () => {
    render(
      await NotificationManager({
        listErrorMessage: "通知一覧を取得できませんでした。",
        nextHref: "/notifications?token=next",
        notifications: [],
        previousHref: "/notifications?token=previous",
        timeZone: "Asia/Tokyo",
        unreadCount: 2,
      })
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

  it("作成日時をプラットフォーム既定タイムゾーンの壁時計で表示する", async () => {
    render(
      await NotificationManager({
        notifications: [notification("n1")],
        timeZone: "America/Los_Angeles",
        unreadCount: 1,
      })
    );

    expect(screen.getByText("2026/05/31 17:00")).toBeDefined();
    expect(screen.queryByText("2026/06/01 9:00")).toBeNull();
  });
});
