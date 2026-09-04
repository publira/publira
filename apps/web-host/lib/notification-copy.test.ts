import { sharedCatalog } from "@publira/i18n/catalog";
import { describe, expect, it } from "vitest";

import type { HostMessages } from "./messages";
import {
  notificationDisplay,
  notificationHref,
  parseNotificationPayload,
} from "./notification-copy";

const JA: HostMessages = sharedCatalog("ja");
const EN: HostMessages = sharedCatalog("en");

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
  it("Construct text for members in public notices", () => {
    expect(
      notificationDisplay(
        "episode_published",
        {
          episode_title: "Episode 1",
          series_id: "SR01",
          series_title: "Series A",
        },
        EN
      )
    ).toEqual({
      description: "“Episode 1” (Series A) is now available.",
      href: "/series/SR01",
      title: "A new episode has been published",
    });
  });

  it("words the notification in the reader's locale, so the ja catalog is Japanese", () => {
    expect(
      notificationDisplay(
        "episode_published",
        {
          episode_title: "Chapter 1",
          series_id: "SR01",
          series_title: "Work A",
        },
        JA
      )
    ).toEqual({
      description: "「Chapter 1」（Work A）が公開されました。",
      href: "/series/SR01",
      title: "新しいエピソードが公開されました",
    });
  });

  it("Don't drop unknown types and make them generic", () => {
    expect(
      notificationDisplay("episode_publish_failed", { series_id: "SR01" }, EN)
    ).toEqual({
      description: "No further details.",
      href: "/series/SR01",
      title: "Notification",
    });
  });
});
