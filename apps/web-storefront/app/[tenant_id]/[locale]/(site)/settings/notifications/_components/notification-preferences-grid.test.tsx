// @vitest-environment jsdom

import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { NotificationPreferenceCells } from "#lib/auth";
import { renderWithClientMessages } from "#lib/render-with-client-messages";

import { NotificationPreferencesGrid } from "./notification-preferences-grid";

const ALL_ON: NotificationPreferenceCells = {
  announcementsEmailEnabled: true,
  announcementsInboxEnabled: true,
  commentsEmailEnabled: true,
  commentsInboxEnabled: true,
  followedCreatorsEmailEnabled: true,
  followedCreatorsInboxEnabled: true,
  followedCreatorsMobilePushEnabled: true,
  followedCreatorsWebPushEnabled: true,
  followedEpisodesEmailEnabled: true,
  followedEpisodesInboxEnabled: true,
  followedEpisodesMobilePushEnabled: true,
  followedEpisodesWebPushEnabled: true,
};

const renderGrid = (cells: NotificationPreferenceCells) =>
  renderWithClientMessages(
    <form aria-label="Preferences">
      <NotificationPreferencesGrid initialCells={cells} />
    </form>
  );

const row = (name: string) => screen.getByRole("group", { name });

const cell = (rowName: string, channel: string) =>
  within(row(rowName)).getByRole("switch", { name: channel });

const isOn = (control: HTMLElement): boolean =>
  control.getAttribute("aria-checked") === "true";

const pressed = (control: HTMLElement): string | null =>
  control.getAttribute("aria-pressed");

const submitted = (): Record<string, FormDataEntryValue> =>
  Object.fromEntries(
    new FormData(screen.getByRole("form", { name: "Preferences" }))
  );

describe("NotificationPreferencesGrid", () => {
  afterEach(() => {
    cleanup();
  });

  it("draws a switch for every cell the server delivers and nothing where it does not", async () => {
    await renderGrid(ALL_ON);

    const followed = row("New episodes of series and episodes you follow");
    expect(within(followed).getAllByRole("switch")).toHaveLength(4);

    const comments = row("Your comments");
    expect(within(comments).getAllByRole("switch")).toHaveLength(2);
    expect(within(comments).getAllByText("Not available")).toHaveLength(2);
  });

  it("submits each switch under its cell's name, and leaves the headings out", async () => {
    await renderGrid({ ...ALL_ON, commentsInboxEnabled: false });

    expect(submitted()).toEqual({
      announcementsEmailEnabled: "on",
      announcementsInboxEnabled: "on",
      commentsEmailEnabled: "on",
      followedCreatorsEmailEnabled: "on",
      followedCreatorsInboxEnabled: "on",
      followedCreatorsMobilePushEnabled: "on",
      followedCreatorsWebPushEnabled: "on",
      followedEpisodesEmailEnabled: "on",
      followedEpisodesInboxEnabled: "on",
      followedEpisodesMobilePushEnabled: "on",
      followedEpisodesWebPushEnabled: "on",
    });
  });

  it("turns a mixed column on, and off again once it is all on", async () => {
    await renderGrid({
      ...ALL_ON,
      announcementsInboxEnabled: false,
      followedEpisodesInboxEnabled: false,
    });

    const inbox = screen.getByRole("button", { name: "Inbox" });
    expect(pressed(inbox)).toBe("mixed");

    fireEvent.click(inbox);
    expect(pressed(inbox)).toBe("true");
    expect(isOn(cell("Announcements", "Inbox"))).toBe(true);
    expect(
      isOn(cell("New episodes of series and episodes you follow", "Inbox"))
    ).toBe(true);

    fireEvent.click(inbox);
    expect(pressed(inbox)).toBe("false");
    expect(isOn(cell("Your comments", "Inbox"))).toBe(false);
    expect(isOn(cell("New episodes by authors you follow", "Browser"))).toBe(
      true
    );
  });

  it("turns a row off from its label, leaving the other rows alone", async () => {
    await renderGrid(ALL_ON);

    fireEvent.click(
      screen.getByRole("button", {
        name: "New episodes by authors you follow",
      })
    );

    const creators = row("New episodes by authors you follow");

    for (const control of within(creators).getAllByRole("switch")) {
      expect(isOn(control)).toBe(false);
    }

    expect(
      isOn(cell("New episodes of series and episodes you follow", "Mobile app"))
    ).toBe(true);
    expect(pressed(screen.getByRole("button", { name: "Browser" }))).toBe(
      "mixed"
    );
  });

  it("turns the email column off from its heading, leaving the other columns alone", async () => {
    await renderGrid(ALL_ON);

    fireEvent.click(screen.getByRole("button", { name: "Email" }));

    for (const category of [
      "New episodes of series and episodes you follow",
      "New episodes by authors you follow",
      "Your comments",
      "Announcements",
    ]) {
      expect(isOn(cell(category, "Email"))).toBe(false);
      expect(isOn(cell(category, "Inbox"))).toBe(true);
    }
  });

  it("moves one cell without touching its row or column", async () => {
    await renderGrid(ALL_ON);

    fireEvent.click(cell("Announcements", "Inbox"));

    expect(isOn(cell("Announcements", "Inbox"))).toBe(false);
    expect(isOn(cell("Your comments", "Inbox"))).toBe(true);
    expect(submitted()).not.toHaveProperty("announcementsInboxEnabled");
  });
});
