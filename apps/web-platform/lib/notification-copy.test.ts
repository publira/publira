import { describe, expect, it } from "vitest";

import {
  notificationDisplay,
  notificationHref,
  parseNotificationPayload,
} from "./notification-copy";

const en = "en" as const;
const ja = "ja" as const;

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
  it("builds publication failure copy from tenant and episode names", async () => {
    await expect(
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
    ).resolves.toEqual({
      description:
        "“Episode 1” (Series A) could not be published for tenant “Acme”. Open the episode and try publishing again.",
      href: "/tenants/SeedTNNTAAA1",
      title: "An episode could not be published",
    });

    await expect(
      notificationDisplay("episode_publish_failed", {}, en)
    ).resolves.toEqual({
      description:
        "the scheduled episode could not be published. Open the episode and try publishing again.",
      href: undefined,
      title: "An episode could not be published",
    });
  });

  it("builds that copy from the catalog it is given, so locale=ja is Japanese", async () => {
    await expect(
      notificationDisplay(
        "episode_publish_failed",
        {
          episode_title: "Episode 1",
          series_title: "Series A",
          tenant_name: "Acme",
        },
        ja
      )
    ).resolves.toEqual({
      description:
        "テナント「Acme」の「Series A」の「Episode 1」を公開できませんでした。エピソードを開いて公開をやり直してください。",
      href: undefined,
      title: "エピソードの公開に失敗しました",
    });
  });

  it("keeps unknown types as generic notifications", async () => {
    await expect(
      notificationDisplay("invite_accepted", { tenant_id: "SeedTNNTAAA1" }, en)
    ).resolves.toEqual({
      description: "No further details are available.",
      href: "/tenants/SeedTNNTAAA1",
      title: "Notification",
    });
  });

  it("names a deleted tenant by its name and domain, with nothing to link to", async () => {
    await expect(
      notificationDisplay(
        "tenant_deleted",
        { tenant_domain: "acme.example.com", tenant_name: "Acme" },
        en
      )
    ).resolves.toEqual({
      description:
        "The tenant “Acme” (acme.example.com) has been deleted, together with everything the install kept for it.",
      href: undefined,
      title: "A tenant was deleted",
    });
  });

  it("links a tenant whose deletion stopped to its page", async () => {
    await expect(
      notificationDisplay(
        "tenant_deletion_failed",
        { tenant_id: "SeedTNNTAAA1", tenant_name: "Acme" },
        en
      )
    ).resolves.toEqual({
      description:
        "Deleting the tenant “Acme” stopped on an error. The worker tries again every minute, and its log names the error.",
      href: "/tenants/SeedTNNTAAA1",
      title: "A tenant could not be deleted",
    });
  });
});
