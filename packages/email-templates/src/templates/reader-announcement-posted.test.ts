import { describe, expect, it } from "vitest";

import { loadEmailMessages } from "../messages";
import { renderEmail } from "../render";
import { readerAnnouncementPostedDataSchema } from "./reader-announcement-posted";

const data = {
  announcement_title: "Scheduled maintenance",
  announcements_url: "https://tenant.example.test/announcements",
  sent_to_everyone: false,
  settings_url: "https://tenant.example.test/settings/notifications",
  tenant_name: "Aoto Press",
};

describe("readerAnnouncementPostedDataSchema", () => {
  it("accepts the variables the sender fills in", () => {
    expect(readerAnnouncementPostedDataSchema.parse(data)).toEqual(data);
  });

  it("takes no settings_url for an announcement sent to everyone", () => {
    const everyone = {
      announcement_title: data.announcement_title,
      announcements_url: data.announcements_url,
      sent_to_everyone: false,
      tenant_name: data.tenant_name,
    };

    expect(
      readerAnnouncementPostedDataSchema.safeParse({
        ...everyone,
        sent_to_everyone: true,
      }).success
    ).toBe(true);
    expect(readerAnnouncementPostedDataSchema.safeParse(everyone).success).toBe(
      false
    );
  });
});

describe("ReaderAnnouncementPostedEmail", () => {
  it("links the announcements and the notification settings", async () => {
    const result = await renderEmail({
      data,
      locale: "en",
      messages: await loadEmailMessages("en"),
      template: "reader_announcement_posted",
      timeZone: "UTC",
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.html).toContain(data.announcement_title);
    expect(result.html).toContain(data.announcements_url);
    expect(result.html).toContain(data.settings_url);
    expect(result.html).not.toContain("to every reader");
  });

  // No setting could have kept such an announcement out, so the mail says it
  // went to everyone rather than pointing at settings.
  it("says an announcement for everyone went to every reader", async () => {
    const result = await renderEmail({
      data: {
        announcement_title: data.announcement_title,
        announcements_url: data.announcements_url,
        sent_to_everyone: true,
        tenant_name: data.tenant_name,
      },
      locale: "en",
      messages: await loadEmailMessages("en"),
      template: "reader_announcement_posted",
      timeZone: "UTC",
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.html).toContain(
      "Aoto Press sent this announcement to every reader"
    );
    expect(result.html).not.toContain(data.settings_url);
  });
});
