import { describe, expect, it } from "vitest";

import {
  notificationDisplay,
  notificationHref,
  parseNotificationPayload,
} from "./notification-copy";

describe("parseNotificationPayload", () => {
  it("extracts only known fields", () => {
    expect(
      parseNotificationPayload(
        JSON.stringify({
          episode_id: "EP01",
          episode_title: "第1話",
          extra: "ignored",
          series_id: "SR01",
          series_title: "作品A",
          tenant_id: "SeedTNNTAAA1",
          tenant_name: "Acme",
        })
      )
    ).toEqual({
      episode_id: "EP01",
      episode_title: "第1話",
      series_id: "SR01",
      series_title: "作品A",
      tenant_id: "SeedTNNTAAA1",
      tenant_name: "Acme",
    });
  });

  it("handles empty or unsupported JSON payloads and omits invalid IDs", () => {
    expect(parseNotificationPayload("")).toEqual({});
    expect(parseNotificationPayload("{")).toEqual({});
    expect(parseNotificationPayload("null")).toEqual({});
    expect(
      parseNotificationPayload(
        JSON.stringify({
          tenant_id: "../etc",
          tenant_name: "Acme",
        })
      )
    ).toEqual({ tenant_name: "Acme" });
  });
});

describe("notificationHref", () => {
  it("links to tenant details when there is a tenant and does not link otherwise", () => {
    expect(notificationHref({ tenant_id: "SeedTNNTAAA1" })).toBe(
      "/tenants/SeedTNNTAAA1"
    );
    expect(
      notificationHref({ episode_id: "EP01", series_id: "SR01" })
    ).toBeUndefined();
    expect(notificationHref({})).toBeUndefined();
  });
});

describe("notificationDisplay", () => {
  it("builds publication failure copy from tenant and episode names", () => {
    expect(
      notificationDisplay("episode_publish_failed", {
        episode_title: "第1話",
        series_title: "作品A",
        tenant_id: "SeedTNNTAAA1",
        tenant_name: "Acme",
      })
    ).toEqual({
      description:
        "テナント「Acme」の「第1話」（作品A）を公開できませんでした。",
      href: "/tenants/SeedTNNTAAA1",
      title: "エピソードの公開に失敗しました",
    });

    expect(notificationDisplay("episode_publish_failed", {})).toEqual({
      description: "予約していたエピソードを公開できませんでした。",
      href: undefined,
      title: "エピソードの公開に失敗しました",
    });
  });

  it("keeps unknown types as generic notifications", () => {
    expect(
      notificationDisplay("invite_accepted", { tenant_id: "SeedTNNTAAA1" })
    ).toEqual({
      description: "内容の詳細はありません。",
      href: "/tenants/SeedTNNTAAA1",
      title: "通知",
    });
  });
});
