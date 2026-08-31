// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  NotificationBell,
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
  NotificationBellMore,
  NotificationBellTrigger,
} from "./notification-bell";

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
    <NotificationBell>
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
            <NotificationBellItem
              href="/ja/series/SR01/episodes/EP01"
              isRead={false}
            >
              <NotificationBellItemState>未読</NotificationBellItemState>
              <NotificationBellItemTitle>
                新しいエピソードが公開されました
              </NotificationBellItemTitle>
              <NotificationBellItemDescription>
                「第1話」が公開されました。
              </NotificationBellItemDescription>
            </NotificationBellItem>
          </NotificationBellList>
        ) : null}
        <NotificationBellMore href="/ja/notifications">
          もっと見る
        </NotificationBellMore>
      </NotificationBellContent>
    </NotificationBell>
  );

describe("NotificationBell", () => {
  it("If it is 0, do not display the number.", () => {
    renderBell();
    const trigger = screen.getByRole("button", {
      name: "通知、未読はありません",
    });
    expect(trigger.textContent).not.toContain("0");
    fireEvent.click(trigger);
    expect(screen.getByText("通知はまだありません。")).toBeDefined();
    expect(screen.getByText("通知が届くとここに表示されます。")).toBeDefined();
    const more = screen.getByRole("link", { name: "もっと見る" });
    expect(more.getAttribute("href")).toBe("/ja/notifications");
    fireEvent.click(more);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("If there are any unread items, display the number.", () => {
    renderBell({ unreadCount: 3 });
    expect(screen.getByRole("button", { name: "通知、未読3件" })).toBeDefined();
    expect(screen.getByText("3")).toBeDefined();
  });

  it("If the number exceeds 99, display 99+.", () => {
    renderBell({ unreadCount: 120 });
    expect(
      screen.getByRole("button", { name: "通知、未読120件" })
    ).toBeDefined();
    expect(screen.getByText("99+")).toBeDefined();
  });

  it("When opened, you can move from the most recent notification to the target content.", () => {
    renderBell({ state: "notification" });
    fireEvent.click(
      screen.getByRole("button", { name: "通知、未読はありません" })
    );
    expect(
      screen
        .getByRole("link", { name: /新しいエピソードが公開されました/u })
        .getAttribute("href")
    ).toBe("/ja/series/SR01/episodes/EP01");
  });

  it.each([
    ["loading", "通知を読み込んでいます。"],
    ["error", "通知を表示できませんでした。"],
  ] as const)("%s 中も通知メニューを開ける", (state, message) => {
    renderBell({ state });
    fireEvent.click(
      screen.getByRole("button", { name: "通知、未読はありません" })
    );
    expect(screen.getByText(message)).toBeDefined();
    expect(screen.getByRole("link", { name: "もっと見る" })).toBeDefined();
  });

  it("Close with Escape to return focus to trigger", () => {
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
