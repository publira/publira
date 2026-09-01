// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  NotificationBellContent,
  NotificationBellEmpty,
  NotificationBellEmptyDescription,
  NotificationBellEmptyTitle,
  NotificationBellError,
  NotificationBellHeader,
  NotificationBellItem,
  NotificationBellItemDescription,
  NotificationBellItemState,
  NotificationBellItemTitle,
  NotificationBellList,
  NotificationBellLoading,
  NotificationBellMenu,
  NotificationBellMore,
  NotificationBellTrigger,
} from "./notification-bell-menu";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

const renderBell = ({
  state = "empty",
  unreadCount = 0,
}: {
  state?: "empty" | "error" | "loading" | "notification";
  unreadCount?: number;
} = {}) =>
  render(
    <NotificationBellMenu>
      <NotificationBellTrigger unreadCount={unreadCount}>
        {unreadCount > 0
          ? `通知、未読${unreadCount}件`
          : "通知、未読はありません"}
      </NotificationBellTrigger>
      <NotificationBellContent>
        <NotificationBellHeader unreadCount={unreadCount}>
          通知
        </NotificationBellHeader>
        {state === "empty" ? (
          <NotificationBellEmpty>
            <NotificationBellEmptyTitle>
              通知はまだありません。
            </NotificationBellEmptyTitle>
            <NotificationBellEmptyDescription>
              通知が届くとここに表示されます。
            </NotificationBellEmptyDescription>
          </NotificationBellEmpty>
        ) : null}
        {state === "loading" ? (
          <NotificationBellLoading>
            通知を読み込んでいます。
          </NotificationBellLoading>
        ) : null}
        {state === "error" ? (
          <NotificationBellError>
            通知を表示できませんでした。
          </NotificationBellError>
        ) : null}
        {state === "notification" ? (
          <NotificationBellList>
            <NotificationBellItem href="/series/SR01" isRead={false}>
              <NotificationBellItemState>未読</NotificationBellItemState>
              <NotificationBellItemTitle>
                予約公開に失敗しました
              </NotificationBellItemTitle>
              <NotificationBellItemDescription>
                公開設定を確認してください。
              </NotificationBellItemDescription>
            </NotificationBellItem>
          </NotificationBellList>
        ) : null}
        <NotificationBellMore href="/notifications">
          もっと見る
        </NotificationBellMore>
      </NotificationBellContent>
    </NotificationBellMenu>
  );

describe("NotificationBellMenu", () => {
  it("goes from a notification row to its content and closes the menu after the choice", () => {
    renderBell({ state: "notification" });
    fireEvent.click(
      screen.getByRole("button", { name: "通知、未読はありません" })
    );
    const notification = screen.getByRole("link", {
      name: /予約公開に失敗しました/u,
    });
    expect(notification.getAttribute("href")).toBe("/series/SR01");

    fireEvent.click(notification);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each([
    ["loading", "通知を読み込んでいます。"],
    ["error", "通知を表示できませんでした。"],
  ] as const)("opens the notification menu even while %s", (state, message) => {
    renderBell({ state });
    fireEvent.click(
      screen.getByRole("button", { name: "通知、未読はありません" })
    );
    expect(screen.getByText(message)).toBeDefined();
    expect(screen.getByRole("link", { name: "もっと見る" })).toBeDefined();
  });

  it("returns focus to the trigger when Escape closes it", () => {
    renderBell();
    const trigger = screen.getByRole("button", {
      name: "通知、未読はありません",
    });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "通知" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
