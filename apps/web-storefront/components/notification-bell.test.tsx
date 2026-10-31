// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as NotificationBell from "./notification-bell";

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
    <NotificationBell.Root>
      <NotificationBell.Trigger unreadCount={unreadCount}>
        {unreadCount > 0
          ? `Notifications, ${unreadCount} unread`
          : "Notifications, none unread"}
      </NotificationBell.Trigger>
      <NotificationBell.Content>
        <NotificationBell.Header unreadCount={unreadCount}>
          Notifications
        </NotificationBell.Header>
        {state === "empty" ? (
          <NotificationBell.Empty>
            <NotificationBell.EmptyTitle>
              You have no notifications yet.
            </NotificationBell.EmptyTitle>
            <NotificationBell.EmptyDescription>
              When an episode is published, your notifications appear here.
            </NotificationBell.EmptyDescription>
          </NotificationBell.Empty>
        ) : null}
        {state === "loading" ? (
          <NotificationBell.Loading>
            Loading notifications.
          </NotificationBell.Loading>
        ) : null}
        {state === "error" ? (
          <NotificationBell.Error>
            Could not display your notifications.
          </NotificationBell.Error>
        ) : null}
        {state === "notification" ? (
          <NotificationBell.List>
            <NotificationBell.Item
              href="/ja/series/SR01/episodes/EP01"
              isRead={false}
            >
              <NotificationBell.ItemState>Unread</NotificationBell.ItemState>
              <NotificationBell.ItemTitle>
                A new episode has been published
              </NotificationBell.ItemTitle>
              <NotificationBell.ItemDescription>
                “Episode 1” has been published.
              </NotificationBell.ItemDescription>
            </NotificationBell.Item>
          </NotificationBell.List>
        ) : null}
        <NotificationBell.More href="/ja/notifications">
          View all
        </NotificationBell.More>
      </NotificationBell.Content>
    </NotificationBell.Root>
  );

describe("NotificationBell", () => {
  it("If it is 0, do not display the number.", () => {
    renderBell();

    const trigger = screen.getByRole("button", {
      name: "Notifications, none unread",
    });

    expect(trigger.textContent).not.toContain("0");
    fireEvent.click(trigger);
    expect(screen.getByText("You have no notifications yet.")).toBeDefined();
    expect(
      screen.getByText(
        "When an episode is published, your notifications appear here."
      )
    ).toBeDefined();
    const more = screen.getByRole("link", { name: "View all" });
    expect(more.getAttribute("href")).toBe("/ja/notifications");
    fireEvent.click(more);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("If there are any unread items, display the number.", () => {
    renderBell({ unreadCount: 3 });
    expect(
      screen.getByRole("button", { name: "Notifications, 3 unread" })
    ).toBeDefined();
    expect(screen.getByText("3")).toBeDefined();
  });

  it("If the number exceeds 99, display 99+.", () => {
    renderBell({ unreadCount: 120 });
    expect(
      screen.getByRole("button", { name: "Notifications, 120 unread" })
    ).toBeDefined();
    expect(screen.getByText("99+")).toBeDefined();
  });

  it("When opened, you can move from the most recent notification to the target content.", () => {
    renderBell({ state: "notification" });
    fireEvent.click(
      screen.getByRole("button", { name: "Notifications, none unread" })
    );
    expect(
      screen
        .getByRole("link", { name: /A new episode has been published/u })
        .getAttribute("href")
    ).toBe("/ja/series/SR01/episodes/EP01");
  });

  it.each([
    ["loading", "Loading notifications."],
    ["error", "Could not display your notifications."],
  ] as const)("opens the notification menu while %s", (state, message) => {
    renderBell({ state });
    fireEvent.click(
      screen.getByRole("button", { name: "Notifications, none unread" })
    );
    expect(screen.getByText(message)).toBeDefined();
    expect(screen.getByRole("link", { name: "View all" })).toBeDefined();
  });

  it("Close with Escape to return focus to trigger", () => {
    renderBell();

    const trigger = screen.getByRole("button", {
      name: "Notifications, none unread",
    });

    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeDefined();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
