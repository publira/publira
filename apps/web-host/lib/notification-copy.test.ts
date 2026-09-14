import { describe, expect, it } from "vitest";

import {
  notificationDisplay,
  notificationHref,
  parseNotificationPayload,
} from "./notification-copy";

const JA = "ja" as const;
const EN = "en" as const;

describe("parseNotificationPayload", () => {
  it("Extract only known fields", () => {
    expect(
      parseNotificationPayload(
        JSON.stringify({
          episode_id: "EP01",
          episode_title: "Episode 1",
          extra: "ignored",
          series_id: "SR01",
          series_title: "Series A",
        })
      )
    ).toEqual({
      episode_id: "EP01",
      episode_title: "Episode 1",
      series_id: "SR01",
      series_title: "Series A",
    });
  });

  it("Empty/corrupted JSON/invalid ID should be an empty payload", () => {
    expect(parseNotificationPayload("")).toEqual({});
    expect(parseNotificationPayload("{")).toEqual({});
    expect(parseNotificationPayload("null")).toEqual({});
    expect(
      parseNotificationPayload(
        JSON.stringify({
          episode_id: "../etc",
          series_id: "SR01",
        })
      )
    ).toEqual({ series_id: "SR01" });
  });

  it("keeps a known hidden_reason and drops a category this build does not have", () => {
    expect(
      parseNotificationPayload(
        JSON.stringify({ hidden_reason: "auto_reports" })
      )
    ).toEqual({ hidden_reason: "auto_reports" });
    expect(
      parseNotificationPayload(JSON.stringify({ hidden_reason: "someday" }))
    ).toEqual({});
  });
});

describe("notificationHref", () => {
  it("If there are series and episodes, go to the public page, if only series, go to the series.", () => {
    expect(notificationHref({ episode_id: "EP01", series_id: "SR01" })).toBe(
      "/series/SR01/episodes/EP01"
    );
    expect(notificationHref({ series_id: "SR01" })).toBe("/series/SR01");
    expect(notificationHref({ episode_id: "EP01" })).toBeUndefined();
    expect(notificationHref({})).toBeUndefined();
  });
});

describe("notificationDisplay", () => {
  it("Construct text for members in public notices", async () => {
    await expect(
      notificationDisplay(
        "episode_published",
        {
          episode_title: "Episode 1",
          series_id: "SR01",
          series_title: "Series A",
        },
        EN
      )
    ).resolves.toEqual({
      description: "“Episode 1” (Series A) is now available.",
      href: "/series/SR01",
      title: "A new episode has been published",
    });
  });

  it("words the notification in the reader's locale, so the ja catalog is Japanese", async () => {
    await expect(
      notificationDisplay(
        "episode_published",
        {
          episode_title: "Chapter 1",
          series_id: "SR01",
          series_title: "Work A",
        },
        JA
      )
    ).resolves.toEqual({
      description: "「Chapter 1」（Work A）が公開されました。",
      href: "/series/SR01",
      title: "新しいエピソードが公開されました",
    });
  });

  it("tells the author their comment went live, and links to the episode", async () => {
    await expect(
      notificationDisplay(
        "comment_approved",
        {
          episode_id: "EP01",
          episode_title: "Episode 1",
          series_id: "SR01",
          series_title: "Series A",
        },
        EN
      )
    ).resolves.toEqual({
      description:
        "Your comment on “Episode 1” (Series A) is now visible to everyone.",
      href: "/series/SR01/episodes/EP01",
      title: "Your comment is now public",
    });
  });

  it("names what took a comment down, per hidden_reason", async () => {
    const payload = {
      episode_id: "EP01",
      episode_title: "Episode 1",
      series_id: "SR01",
    };

    await expect(
      notificationDisplay(
        "comment_hidden",
        { ...payload, hidden_reason: "staff" as const },
        EN
      )
    ).resolves.toEqual({
      description: "Your comment on “Episode 1” was removed by the operator.",
      href: "/series/SR01/episodes/EP01",
      title: "Your comment was removed",
    });

    await expect(
      notificationDisplay(
        "comment_hidden",
        { ...payload, hidden_reason: "auto_reports" as const },
        EN
      )
    ).resolves.toEqual({
      description:
        "Your comment on “Episode 1” was removed after reports from other readers.",
      href: "/series/SR01/episodes/EP01",
      title: "Your comment was removed",
    });

    await expect(
      notificationDisplay("comment_hidden", payload, EN)
    ).resolves.toEqual({
      description: "Your comment on “Episode 1” was removed.",
      href: "/series/SR01/episodes/EP01",
      title: "Your comment was removed",
    });
  });

  it("still words a comment row when the payload carries no title", async () => {
    await expect(
      notificationDisplay("comment_approved", {}, JA)
    ).resolves.toEqual({
      description: "エピソードへのコメントが公開されました。",
      href: undefined,
      title: "コメントが公開されました",
    });
  });

  it("Don't drop unknown types and make them generic", async () => {
    await expect(
      notificationDisplay("episode_publish_failed", { series_id: "SR01" }, EN)
    ).resolves.toEqual({
      description: "No further details.",
      href: "/series/SR01",
      title: "Notification",
    });
  });
});
