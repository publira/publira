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
              No notifications yet.
            </NotificationBellEmptyTitle>
            <NotificationBellEmptyDescription>
              New notifications will appear here.
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
            Could not show the notifications.
          </NotificationBellError>
        ) : null}
        {state === "notification" ? (
          <NotificationBellList>
            <NotificationBellItem href="/tenants/tenant_01" isRead={false}>
              <NotificationBellItemState>Unread</NotificationBellItemState>
              <NotificationBellItemTitle>
                Scheduled publication failed
              </NotificationBellItemTitle>
              <NotificationBellItemDescription>
                Check the publication settings of this tenant.
              </NotificationBellItemDescription>
            </NotificationBellItem>
          </NotificationBellList>
        ) : null}
        <NotificationBellMore href="/notifications">
          See more
        </NotificationBellMore>
      </NotificationBellContent>
    </NotificationBell>
  );

describe("NotificationBell", () => {
  it("does not show a count when there are no notifications", () => {
    renderBell();
    const trigger = screen.getByRole("button", {
      name: "Notifications, none unread",
    });
    expect(trigger.textContent).not.toContain("0");
    fireEvent.click(trigger);
    expect(screen.getByText("No notifications yet.")).toBeDefined();
    expect(
      screen.getByText("New notifications will appear here.")
    ).toBeDefined();
    const more = screen.getByRole("link", { name: "See more" });
    expect(more.getAttribute("href")).toBe("/notifications");
    fireEvent.click(more);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows a count when there are unread notifications", () => {
    renderBell({ unreadCount: 3 });
    expect(
      screen.getByRole("button", { name: "Notifications, 3 unread" })
    ).toBeDefined();
    expect(screen.getByText("3")).toBeDefined();
  });

  it("shows 99+ when the count exceeds 99", () => {
    renderBell({ unreadCount: 120 });
    expect(
      screen.getByRole("button", { name: "Notifications, 120 unread" })
    ).toBeDefined();
    expect(screen.getByText("99+")).toBeDefined();
  });

  it("navigates to the target content from a recent notification when opened", () => {
    renderBell({ state: "notification" });
    fireEvent.click(
      screen.getByRole("button", { name: "Notifications, none unread" })
    );
    expect(
      screen
        .getByRole("link", { name: /Scheduled publication failed/u })
        .getAttribute("href")
    ).toBe("/tenants/tenant_01");
  });

  it.each([
    ["loading", "Loading notifications."],
    ["error", "Could not show the notifications."],
  ] as const)("opens the notification menu while %s too", (state, message) => {
    renderBell({ state });
    fireEvent.click(
      screen.getByRole("button", { name: "Notifications, none unread" })
    );
    expect(screen.getByText(message)).toBeDefined();
    expect(screen.getByRole("link", { name: "See more" })).toBeDefined();
  });

  it("returns focus to the trigger when closed with Escape", () => {
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
