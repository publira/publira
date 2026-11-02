import { describe, expect, it } from "vitest";

import { loadEmailMessages } from "../messages";
import { renderEmail } from "../render";
import { staffEpisodeReviewReturnedDataSchema } from "./staff-episode-review-returned";

const data = {
  comment: "The speech bubble on page 4 is cut off.",
  episode_title: "The First Night",
  episode_url:
    "https://admin.tenant.example.test/series/SERIES000001/episodes/EPISODE00001",
  series_title: "The Lighthouse Keeper",
  tenant_name: "Aoto Press",
};

describe("staffEpisodeReviewReturnedDataSchema", () => {
  it("accepts the variables the sender fills in", () => {
    expect(staffEpisodeReviewReturnedDataSchema.parse(data)).toEqual(data);
  });

  it("requires the comment", () => {
    const parsed = staffEpisodeReviewReturnedDataSchema.safeParse({
      ...data,
      comment: " ",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects an episode_url that is not an http(s) URL", () => {
    const parsed = staffEpisodeReviewReturnedDataSchema.safeParse({
      ...data,
      episode_url: "ftp://admin.tenant.example.test/episode",
    });

    expect(parsed.success).toBe(false);
  });
});

describe("StaffEpisodeReviewReturnedEmail", () => {
  it("quotes the comment and links the episode in the console", async () => {
    const result = await renderEmail({
      data,
      locale: "en",
      messages: await loadEmailMessages("en"),
      template: "staff_episode_review_returned",
      timeZone: "UTC",
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.html).toContain("An episode was returned for changes");
    expect(result.html).toContain(data.comment);
    expect(result.html).toContain(data.series_title);
    expect(result.html).toContain(data.episode_title);
    expect(result.html).toContain(data.episode_url);
  });

  it("the ja mail comes from the Japanese catalog", async () => {
    const result = await renderEmail({
      data,
      locale: "ja",
      messages: await loadEmailMessages("ja"),
      template: "staff_episode_review_returned",
      timeZone: "UTC",
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.html).toContain("エピソードが差し戻されました");
  });
});
