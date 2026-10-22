import type { NotificationPreferenceCells } from "#lib/auth";

/** Why a notification reached the reader: a row of the grid. */
export type NotificationCategory =
  | "announcements"
  | "comments"
  | "followedCreators"
  | "followedEpisodes";

/** Where a notification reaches the reader: a column of the grid. */
export type NotificationChannel = "inbox" | "mobilePush" | "webPush";

export type NotificationCell = keyof NotificationPreferenceCells;

/**
 * The cell behind each category on each channel. A channel the server does not
 * deliver a category on has no cell, and the grid draws that place as not
 * available rather than as a switch that would store nothing.
 */
const NOTIFICATION_CELLS: Record<
  NotificationCategory,
  Partial<Record<NotificationChannel, NotificationCell>>
> = {
  announcements: { inbox: "announcementsInboxEnabled" },
  comments: { inbox: "commentsInboxEnabled" },
  followedCreators: {
    inbox: "followedCreatorsInboxEnabled",
    mobilePush: "followedCreatorsMobilePushEnabled",
    webPush: "followedCreatorsWebPushEnabled",
  },
  followedEpisodes: {
    inbox: "followedEpisodesInboxEnabled",
    mobilePush: "followedEpisodesMobilePushEnabled",
    webPush: "followedEpisodesWebPushEnabled",
  },
};

export const notificationCell = (
  category: NotificationCategory,
  channel: NotificationChannel
): NotificationCell | undefined => NOTIFICATION_CELLS[category][channel];

export const rowCells = (category: NotificationCategory): NotificationCell[] =>
  Object.values(NOTIFICATION_CELLS[category]);

export const columnCells = (channel: NotificationChannel): NotificationCell[] =>
  Object.values(NOTIFICATION_CELLS).flatMap((row) => row[channel] ?? []);

/**
 * What a row or column control shows. It is read off the cells every time and
 * never stored, so it cannot disagree with them.
 */
export type CellGroupState = "mixed" | "off" | "on";

export const cellGroupState = (
  cells: NotificationPreferenceCells,
  group: NotificationCell[]
): CellGroupState => {
  const on = group.filter((cell) => cells[cell]).length;
  if (on === group.length) {
    return "on";
  }
  return on === 0 ? "off" : "mixed";
};

/**
 * Turns every cell of the group on, unless they are all on already, in which
 * case it turns them all off. A mixed group therefore goes to on first, which
 * is what a reader pressing a heading to "take everything" expects.
 */
export const toggleCellGroup = (
  cells: NotificationPreferenceCells,
  group: NotificationCell[]
): NotificationPreferenceCells => {
  const next = cellGroupState(cells, group) !== "on";
  return {
    ...cells,
    ...Object.fromEntries(group.map((cell) => [cell, next])),
  };
};
