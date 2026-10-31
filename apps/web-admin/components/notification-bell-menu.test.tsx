// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as NotificationBell from "./notification-bell";

// The tree's module also holds its Server Component parts, which read the
// tenant through `next/root-params`, a module only the Next.js compiler can
// provide. Nothing here renders them.
vi.mock("#lib/tenant-id", () => ({
  getTenantId: () => Promise.resolve("TENANT001"),
}));

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
    <NotificationBell.Menu>
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
              Your notifications appear here.
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
            Could not display notifications.
          </NotificationBell.Error>
        ) : null}
        {state === "notification" ? (
          <NotificationBell.List>
            <NotificationBell.Item href="/series/SR01" isRead={false}>
              <NotificationBell.ItemState>Unread</NotificationBell.ItemState>
              <NotificationBell.ItemTitle>
                An episode could not be published
              </NotificationBell.ItemTitle>
              <NotificationBell.ItemDescription>
                Check the publication settings.
              </NotificationBell.ItemDescription>
            </NotificationBell.Item>
          </NotificationBell.List>
        ) : null}
        <NotificationBell.More href="/notifications">
          View all
        </NotificationBell.More>
      </NotificationBell.Content>
    </NotificationBell.Menu>
  );

describe("NotificationBell.Menu", () => {
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
