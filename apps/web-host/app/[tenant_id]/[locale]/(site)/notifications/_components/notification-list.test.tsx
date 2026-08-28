// @vitest-environment jsdom

import { sharedCatalog } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { NotificationItem } from "../notification-types";
import { NotificationList } from "./notification-list";

vi.mock("next/link", () => ({
  default: ({ children, href }: React.ComponentProps<"a">) => (
    <a href={href}>{children}</a>
  ),
}));

// `getLocale()` reads `next/root-params`, which only the Next.js compiler can
// provide. The catalog is the real one, so the assertions stay on the copy a
// reader actually sees.
vi.mock("#lib/locale", () => ({
  getLocale: () => Promise.resolve("ja"),
  loadHostMessages: () => Promise.resolve(sharedCatalog("ja")),
}));

vi.mock("./notification-read-actions", () => ({
  MarkAllNotificationsAsReadButton: ({ tenantId }: { tenantId: string }) => (
    <button type="button">すべて既読にする {tenantId}</button>
  ),
  MarkNotificationAsReadButton: ({
    notificationId,
  }: {
    notificationId: string;
  }) => <button type="button">既読にする {notificationId}</button>,
}));

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const notification = (
  id: string,
  overrides: Partial<NotificationItem> = {}
): NotificationItem => ({
  createdAt: "2026-06-01T00:00:00Z",
  description: "「第1話」（作品A）が公開されました。",
  href: "/series/SR01/episodes/EP01",
  id,
  isRead: false,
  notificationType: "episode_published",
  title: "新しいエピソードが公開されました",
  ...overrides,
});

/**
 * The component is an async Server Component, which the client renderer cannot
 * mount on its own: awaiting it here hands `render` the element tree it
 * produced.
 */
const renderList = async (
  props: Partial<React.ComponentProps<typeof NotificationList>> = {}
) => {
  render(
    await NotificationList({
      nextToken: "",
      notifications: [],
      previousToken: "",
      tenantId,
      timeZone: "Asia/Tokyo",
      token: "",
      unreadCount: 0,
      ...props,
    })
  );
};

afterEach(() => {
  cleanup();
});

describe("NotificationList", () => {
  it("最初のページが空なら未着として案内する", async () => {
    await renderList();

    expect(screen.getByText("通知はまだありません。")).toBeDefined();
    expect(screen.queryByLabelText("通知一覧ページング")).toBeNull();
    expect(screen.queryByText(`すべて既読にする ${tenantId}`)).toBeNull();
  });

  it("ページ送りの先が空でも一覧全体が空だとは案内しない", async () => {
    await renderList({ previousToken: "previous", token: "current" });

    expect(
      screen.getByText("このページに表示できる通知がありません。")
    ).toBeDefined();
    const previous = screen.getByRole("link", { name: "前のページ" });
    expect(previous.getAttribute("href")).toBe(
      "/ja/notifications?token=previous"
    );
  });

  it("未読行とリンク、既読ボタンを描画する", async () => {
    await renderList({
      nextToken: "next",
      notifications: [
        notification("n1"),
        notification("n2", {
          createdAt: "2026-05-31T00:00:00Z",
          href: undefined,
          isRead: true,
          title: "通知",
        }),
      ],
      previousToken: "previous",
      unreadCount: 1,
    });

    const titleLink = screen.getByRole("link", {
      name: "新しいエピソードが公開されました",
    });
    expect(titleLink.getAttribute("href")).toBe(
      "/ja/series/SR01/episodes/EP01"
    );
    expect(screen.getByText("2026/06/01 9:00")).toBeDefined();
    expect(screen.getByText("未読")).toBeDefined();
    expect(screen.getByText("既読")).toBeDefined();
    expect(screen.getByText("既読にする n1")).toBeDefined();
    expect(screen.queryByText("既読にする n2")).toBeNull();
    expect(screen.getByText(`すべて既読にする ${tenantId}`)).toBeDefined();
    expect(
      screen.getByRole("link", { name: "前のページ" }).getAttribute("href")
    ).toBe("/ja/notifications?token=previous");
    expect(
      screen.getByRole("link", { name: "次のページ" }).getAttribute("href")
    ).toBe("/ja/notifications?token=next");
  });

  it("取得失敗時はエラーだけを出し、空一覧としては案内しない", async () => {
    await renderList({
      listErrorMessage: "通知一覧を取得できませんでした。",
      nextToken: "next",
      previousToken: "previous",
      unreadCount: 2,
    });

    const sectionError = screen.getByRole("alert");
    expect(sectionError.textContent).toContain(
      "通知一覧を表示できませんでした"
    );
    expect(sectionError.textContent).toContain(
      "通知一覧を取得できませんでした。"
    );
    expect(screen.queryByText("通知はまだありません。")).toBeNull();
    expect(screen.queryByLabelText("通知一覧ページング")).toBeNull();
    expect(screen.queryByText(`すべて既読にする ${tenantId}`)).toBeNull();
  });

  it("作成日時をテナントタイムゾーンの壁時計で表示する", async () => {
    await renderList({
      notifications: [notification("n1")],
      timeZone: "America/Los_Angeles",
      unreadCount: 1,
    });

    expect(screen.getByText("2026/05/31 17:00")).toBeDefined();
    expect(screen.queryByText("2026/06/01 9:00")).toBeNull();
  });
});
