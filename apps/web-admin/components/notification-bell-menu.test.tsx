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
          ? `Notifications, ${unreadCount} unread`
          : "Notifications, none unread"}
      </NotificationBellTrigger>
      <NotificationBellContent>
        <NotificationBellHeader unreadCount={unreadCount}>
          Notifications
        </NotificationBellHeader>
        {state === "empty" ? (
          <NotificationBellEmpty>
            <NotificationBellEmptyTitle>
              You have no notifications yet.
            </NotificationBellEmptyTitle>
            <NotificationBellEmptyDescription>
              Your notifications appear here.
            </NotificationBellEmptyDescription>
          </NotificationBellEmpty>
        ) : null}
        {state === "loading" ? (
          <NotificationBellLoading>
            Loading notifications.
          </NotificationBellLoading>
        ) : null}
        {state === "error" ? (
          <NotificationBellError>
            Could not display notifications.
          </NotificationBellError>
        ) : null}
        {state === "notification" ? (
          <NotificationBellList>
            <NotificationBellItem href="/series/SR01" isRead={false}>
              <NotificationBellItemState>Unread</NotificationBellItemState>
              <NotificationBellItemTitle>
                An episode could not be published
              </NotificationBellItemTitle>
              <NotificationBellItemDescription>
                Check the publication settings.
              </NotificationBellItemDescription>
            </NotificationBellItem>
          </NotificationBellList>
        ) : null}
        <NotificationBellMore href="/notifications">
          View all
        </NotificationBellMore>
      </NotificationBellContent>
    </NotificationBellMenu>
  );

describe("NotificationBellMenu", () => {
  it("goes from a notification row to its content and closes the menu after the choice", () => {
    renderBell({ state: "notification" });
    fireEvent.click(
      screen.getByRole("button", { name: "Notifications, none unread" })
    );
    const notification = screen.getByRole("link", {
      name: /An episode could not be published/u,
    });
    expect(notification.getAttribute("href")).toBe("/series/SR01");

    fireEvent.click(notification);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each([
    ["loading", "Loading notifications."],
    ["error", "Could not display notifications."],
  ] as const)("opens the notification menu even while %s", (state, message) => {
    renderBell({ state });
    fireEvent.click(
      screen.getByRole("button", { name: "Notifications, none unread" })
    );
    expect(screen.getByText(message)).toBeDefined();
    expect(screen.getByRole("link", { name: "View all" })).toBeDefined();
  });

  it("returns focus to the trigger when Escape closes it", () => {
    renderBell();
    const trigger = screen.getByRole("button", {
      name: "Notifications, none unread",
    });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Notifications" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
