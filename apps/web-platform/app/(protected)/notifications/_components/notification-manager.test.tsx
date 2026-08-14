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
    label: string;
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
  it("最初のページが空なら未着として案内する", () => {
    render(
      <NotificationManager
        notifications={[]}
        pageSize={20}
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
        notifications={[]}
        pageSize={20}
        previousHref="/notifications?token=previous"
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
        nextHref="/notifications?token=next"
        notifications={[
          notification("n1"),
          notification("n2", {
            createdAt: "2026-05-31T00:00:00Z",
            href: undefined,
            isRead: true,
            title: "通知",
          }),
        ]}
        pageSize={20}
        previousHref="/notifications?token=previous"
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
        listErrorMessage="通知一覧を取得できませんでした。"
        nextHref="/notifications?token=next"
        notifications={[]}
        pageSize={20}
        previousHref="/notifications?token=previous"
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
        notifications={[notification("n1")]}
        pageSize={20}
        timeZone="America/Los_Angeles"
        unreadCount={1}
      />
    );

    expect(screen.getByText("2026/05/31 17:00")).toBeDefined();
    expect(screen.queryByText("2026/06/01 9:00")).toBeNull();
  });
});
