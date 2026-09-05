import { sharedCatalog } from "@publira/i18n/catalog";
import { describe, expect, it } from "vitest";

import {
  notificationDisplay,
  notificationHref,
  parseNotificationPayload,
} from "./notification-copy";

const en = sharedCatalog("en");

describe("parseNotificationPayload", () => {
  it("picks out only the fields it knows", () => {
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

  it("turns empty text, broken JSON and an invalid id into an empty payload", () => {
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
  it("links to the edit screen with a series and an episode, and to the series with a series alone", () => {
    expect(notificationHref({ episode_id: "EP01", series_id: "SR01" })).toBe(
      "/series/SR01/episodes/EP01"
    );
    expect(notificationHref({ series_id: "SR01" })).toBe("/series/SR01");
    expect(notificationHref({ episode_id: "EP01" })).toBeUndefined();
    expect(notificationHref({})).toBeUndefined();
  });
});

describe("notificationDisplay", () => {
  it("builds the wording of a successful and a failed publication by type", () => {
    expect(
      notificationDisplay(
        "episode_published",
        {
          episode_title: "Episode 1",
          series_id: "SR01",
          series_title: "Series A",
        },
        en
      )
    ).toEqual({
      description: "“Episode 1” (Series A) was published.",
      href: "/series/SR01",
      title: "An episode was published",
    });

    expect(
      notificationDisplay(
        "episode_publish_failed",
        {
          episode_id: "EP01",
          series_id: "SR01",
        },
        en
      )
    ).toEqual({
      description: "the scheduled episode could not be published.",
      href: "/series/SR01/episodes/EP01",
      title: "An episode could not be published",
    });
  });

  // The `ja` mirror of the case above. Without it a builder that ignored the
  // catalog it was handed and returned English unconditionally would still pass
  // every other assertion in this file.
  it("resolves its copy from the catalog it is given, so a ja catalog is Japanese", () => {
    expect(
      notificationDisplay(
        "episode_published",
        { episode_title: "Episode 1", series_title: "Series A" },
        sharedCatalog("ja")
      )
    ).toEqual({
      description: "「Episode 1」（Series A）を公開しました。",
      href: undefined,
      title: "エピソードが公開されました",
    });
  });

  it("keeps an unknown type as generic instead of dropping it", () => {
    expect(
      notificationDisplay("invite_accepted", { series_id: "SR01" }, en)
    ).toEqual({
      description: "No further details are available.",
      href: "/series/SR01",
      title: "Notification",
    });
  });
});
