import { sharedCatalog } from "@publira/i18n/catalog";
import { describe, expect, it } from "vitest";

import {
  notificationDisplay,
  notificationHref,
  parseNotificationPayload,
} from "./notification-copy";

const ja = sharedCatalog("ja");

describe("parseNotificationPayload", () => {
  it("既知のフィールドだけを取り出す", () => {
    expect(
      parseNotificationPayload(
        JSON.stringify({
          episode_id: "EP01",
          episode_title: "第1話",
          extra: "ignored",
          series_id: "SR01",
          series_title: "作品A",
        })
      )
    ).toEqual({
      episode_id: "EP01",
      episode_title: "第1話",
      series_id: "SR01",
      series_title: "作品A",
    });
  });

  it("空・壊れた JSON・不正な ID は空の payload にする", () => {
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
  it("series と episode があれば編集画面へ、series だけならシリーズへ", () => {
    expect(notificationHref({ episode_id: "EP01", series_id: "SR01" })).toBe(
      "/series/SR01/episodes/EP01"
    );
    expect(notificationHref({ series_id: "SR01" })).toBe("/series/SR01");
    expect(notificationHref({ episode_id: "EP01" })).toBeUndefined();
    expect(notificationHref({})).toBeUndefined();
  });
});

describe("notificationDisplay", () => {
  it("公開成功・失敗は type ごとに文言を組み立てる", () => {
    expect(
      notificationDisplay(
        "episode_published",
        {
          episode_title: "第1話",
          series_id: "SR01",
          series_title: "作品A",
        },
        ja
      )
    ).toEqual({
      description: "「第1話」（作品A）を公開しました。",
      href: "/series/SR01",
      title: "エピソードが公開されました",
    });

    expect(
      notificationDisplay(
        "episode_publish_failed",
        {
          episode_id: "EP01",
          series_id: "SR01",
        },
        ja
      )
    ).toEqual({
      description: "予約していたエピソードを公開できませんでした。",
      href: "/series/SR01/episodes/EP01",
      title: "エピソードの公開に失敗しました",
    });
  });

  it("resolves its copy from the catalog it is given", () => {
    expect(
      notificationDisplay(
        "episode_published",
        { episode_title: "Episode 1", series_title: "Series A" },
        sharedCatalog("en")
      )
    ).toEqual({
      description: "“Episode 1” (Series A) was published.",
      href: undefined,
      title: "An episode was published",
    });
  });

  it("未知の type は落とさず generic にする", () => {
    expect(
      notificationDisplay("invite_accepted", { series_id: "SR01" }, ja)
    ).toEqual({
      description: "内容の詳細はありません。",
      href: "/series/SR01",
      title: "通知",
    });
  });
});
