import { sharedCatalog } from "@publira/i18n/catalog";
import { describe, expect, it } from "vitest";

import {
  notificationDisplay,
  notificationHref,
  parseNotificationPayload,
} from "./notification-copy";

const en = sharedCatalog("en");
const ja = sharedCatalog("ja");

describe("parseNotificationPayload", () => {
  it("extracts only known fields", () => {
    expect(
      parseNotificationPayload(
        JSON.stringify({
          episode_id: "EP01",
          episode_title: "Episode 1",
          extra: "ignored",
          series_id: "SR01",
          series_title: "Series A",
          tenant_id: "SeedTNNTAAA1",
          tenant_name: "Acme",
        })
      )
    ).toEqual({
      episode_id: "EP01",
      episode_title: "Episode 1",
      series_id: "SR01",
      series_title: "Series A",
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
      notificationDisplay(
        "episode_publish_failed",
        {
          episode_title: "Episode 1",
          series_title: "Series A",
          tenant_id: "SeedTNNTAAA1",
          tenant_name: "Acme",
        },
        en
      )
    ).toEqual({
      description:
        "“Episode 1” (Series A) could not be published for tenant “Acme”.",
      href: "/tenants/SeedTNNTAAA1",
      title: "An episode could not be published",
    });

    expect(notificationDisplay("episode_publish_failed", {}, en)).toEqual({
      description: "the scheduled episode could not be published.",
      href: undefined,
      title: "An episode could not be published",
    });
  });

  it("builds that copy from the catalog it is given, so locale=ja is Japanese", () => {
    expect(
      notificationDisplay(
        "episode_publish_failed",
        {
          episode_title: "Episode 1",
          series_title: "Series A",
          tenant_name: "Acme",
        },
        ja
      )
    ).toEqual({
      description:
        "テナント「Acme」の「Episode 1」（Series A）を公開できませんでした。",
      href: undefined,
      title: "エピソードの公開に失敗しました",
    });
  });

  it("keeps unknown types as generic notifications", () => {
    expect(
      notificationDisplay("invite_accepted", { tenant_id: "SeedTNNTAAA1" }, en)
    ).toEqual({
      description: "No further details are available.",
      href: "/tenants/SeedTNNTAAA1",
      title: "Notification",
    });
  });
});
