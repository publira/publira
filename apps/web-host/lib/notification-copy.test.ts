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
  it("series と episode があれば公開ページへ、series だけならシリーズへ", () => {
    expect(notificationHref({ episode_id: "EP01", series_id: "SR01" })).toBe(
      "/series/SR01/episodes/EP01"
    );
    expect(notificationHref({ series_id: "SR01" })).toBe("/series/SR01");
    expect(notificationHref({ episode_id: "EP01" })).toBeUndefined();
    expect(notificationHref({})).toBeUndefined();
  });
});

describe("notificationDisplay", () => {
  it("公開通知は会員向けの文言を組み立てる", () => {
    expect(
      notificationDisplay(
        "episode_published",
        {
          episode_title: "第1話",
          series_id: "SR01",
          series_title: "作品A",
        },
        JA
      )
    ).toEqual({
      description: "「第1話」（作品A）が公開されました。",
      href: "/series/SR01",
      title: "新しいエピソードが公開されました",
    });
  });

  it("ロケールに合わせて文言を切り替える", () => {
    expect(
      notificationDisplay(
        "episode_published",
        {
          episode_title: "Chapter 1",
          series_id: "SR01",
          series_title: "Work A",
        },
        EN
      )
    ).toEqual({
      description: "“Chapter 1” (Work A) is now available.",
      href: "/series/SR01",
      title: "A new episode has been published",
    });
  });

  it("未知の type は落とさず generic にする", () => {
    expect(
      notificationDisplay("episode_publish_failed", { series_id: "SR01" }, JA)
    ).toEqual({
      description: "内容の詳細はありません。",
      href: "/series/SR01",
      title: "通知",
    });
  });
});
