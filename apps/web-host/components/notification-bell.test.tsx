// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NotificationBell } from "./notification-bell";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
});

const copy = {
  emptyDescription: "通知が届くとここに表示されます。",
  emptyTitle: "通知はまだありません。",
  errorDescription: "通知を表示できませんでした。",
  heading: "通知",
  loadingDescription: "通知を読み込んでいます。",
  more: "もっと見る",
  read: "既読",
  unread: "未読",
};

const renderBell = (
  props: Partial<React.ComponentProps<typeof NotificationBell>> = {}
) =>
  render(
    <NotificationBell
      copy={copy}
      label="通知、未読はありません"
      moreHref="/ja/notifications"
      unreadCount={0}
      {...props}
    />
  );

describe("NotificationBell", () => {
  it("0 件なら件数を出さない", () => {
    renderBell();

    const trigger = screen.getByRole("button", {
      name: "通知、未読はありません",
    });
    expect(trigger.textContent).not.toContain("0");

    fireEvent.click(trigger);
    expect(screen.getByText("通知はまだありません。")).toBeDefined();
    expect(screen.getByText("通知が届くとここに表示されます。")).toBeDefined();
    expect(
      screen.getByRole("link", { name: "もっと見る" }).getAttribute("href")
    ).toBe("/ja/notifications");
  });

  it("未読があれば件数を出す", () => {
    renderBell({ label: "通知、未読3件", unreadCount: 3 });

    expect(screen.getByRole("button", { name: "通知、未読3件" })).toBeDefined();
    expect(screen.getByText("3")).toBeDefined();
  });

  it("99 件を超えたら 99+ と出す", () => {
    renderBell({ label: "通知、未読120件", unreadCount: 120 });

    expect(
      screen.getByRole("button", { name: "通知、未読120件" })
    ).toBeDefined();
    expect(screen.getByText("99+")).toBeDefined();
  });

  it("開くと直近の通知から対象コンテンツへ移動できる", () => {
    renderBell({
      notifications: [
        {
          description: "「第1話」が公開されました。",
          href: "/ja/series/SR01/episodes/EP01",
          id: "notification-1",
          isRead: false,
          title: "新しいエピソードが公開されました",
        },
      ],
    });

    fireEvent.click(
      screen.getByRole("button", { name: "通知、未読はありません" })
    );

    expect(
      screen
        .getByRole("link", {
          name: /新しいエピソードが公開されました/u,
        })
        .getAttribute("href")
    ).toBe("/ja/series/SR01/episodes/EP01");
    expect(
      screen.getByRole("link", { name: "もっと見る" }).getAttribute("href")
    ).toBe("/ja/notifications");
  });

  it.each([
    ["loading", "通知を読み込んでいます。"],
    ["error", "通知を表示できませんでした。"],
  ] as const)("%s 中も通知メニューを開ける", (status, message) => {
    renderBell({ status });

    fireEvent.click(
      screen.getByRole("button", { name: "通知、未読はありません" })
    );

    expect(screen.getByText(message)).toBeDefined();
    expect(screen.getByRole("link", { name: "もっと見る" })).toBeDefined();
  });

  it("Escape で閉じるとトリガーへフォーカスが戻る", () => {
    renderBell();
    const trigger = screen.getByRole("button", {
      name: "通知、未読はありません",
    });
    trigger.focus();

    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeDefined();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
