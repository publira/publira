import { describe, expect, it } from "vitest";

import type { NotificationPreferenceCells } from "#lib/auth";

import {
  cellGroupState,
  columnCells,
  notificationCell,
  rowCells,
  toggleCellGroup,
} from "./notification-grid";

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

describe("notification grid", () => {
  it("has no cell where the server delivers nothing", () => {
    expect(notificationCell("announcements", "webPush")).toBeUndefined();
    expect(notificationCell("comments", "mobilePush")).toBeUndefined();
    expect(notificationCell("followedCreators", "webPush")).toBe(
      "followedCreatorsWebPushEnabled"
    );
    expect(notificationCell("comments", "email")).toBe("commentsEmailEnabled");
  });

  it("collects a row and a column from the cells that exist", () => {
    expect(rowCells("comments").toSorted()).toEqual([
      "commentsEmailEnabled",
      "commentsInboxEnabled",
    ]);
    expect(columnCells("webPush").toSorted()).toEqual([
      "followedCreatorsWebPushEnabled",
      "followedEpisodesWebPushEnabled",
    ]);
    expect(columnCells("inbox")).toHaveLength(4);
    expect(columnCells("email")).toHaveLength(4);
  });

  it("reads a group as on, off, or mixed", () => {
    const group = columnCells("mobilePush");

    expect(cellGroupState(ALL_ON, group)).toBe("on");
    expect(
      cellGroupState(
        {
          ...ALL_ON,
          followedCreatorsMobilePushEnabled: false,
          followedEpisodesMobilePushEnabled: false,
        },
        group
      )
    ).toBe("off");
    expect(
      cellGroupState(
        { ...ALL_ON, followedCreatorsMobilePushEnabled: false },
        group
      )
    ).toBe("mixed");
  });

  it("turns a mixed group on, and a group that is all on off", () => {
    const group = columnCells("inbox");
    const mixed = { ...ALL_ON, commentsInboxEnabled: false };

    const on = toggleCellGroup(mixed, group);
    expect(cellGroupState(on, group)).toBe("on");

    const off = toggleCellGroup(on, group);
    expect(cellGroupState(off, group)).toBe("off");
  });

  it("leaves every cell outside the group as it was", () => {
    const cells = { ...ALL_ON, followedEpisodesWebPushEnabled: false };

    const toggled = toggleCellGroup(cells, rowCells("followedCreators"));

    expect(toggled).toEqual({
      ...cells,
      followedCreatorsEmailEnabled: false,
      followedCreatorsInboxEnabled: false,
      followedCreatorsMobilePushEnabled: false,
      followedCreatorsWebPushEnabled: false,
    });
  });
});
