import { describe, expect, it } from "vitest";

import { loadEmailMessages } from "../messages";
import { renderEmail } from "../render";
import { readerCommentApprovedDataSchema } from "./reader-comment-approved";

const data = {
  episode_title: "The First Night",
  episode_url:
    "https://tenant.example.test/series/SERIES000001/episodes/EPISODE00001",
  series_title: "The Lighthouse Keeper",
  settings_url: "https://tenant.example.test/settings/notifications",
  tenant_name: "Aoto Press",
};

describe("readerCommentApprovedDataSchema", () => {
  it("accepts the variables the sender fills in", () => {
    expect(readerCommentApprovedDataSchema.parse(data)).toEqual(data);
  });

  it("rejects a settings_url that is not an http(s) URL", () => {
    const parsed = readerCommentApprovedDataSchema.safeParse({
      ...data,
      settings_url: "data:text/html,<p>settings</p>",
    });

    expect(parsed.success).toBe(false);
  });
});

describe("ReaderCommentApprovedEmail", () => {
  it("names the episode the comment is on and links it", async () => {
    const result = await renderEmail({
      data,
      locale: "en",
      messages: await loadEmailMessages("en"),
      template: "reader_comment_approved",
      timeZone: "UTC",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.html).toContain("Your comment is now public");
    expect(result.html).toContain(data.episode_title);
    expect(result.html).toContain(data.episode_url);
    expect(result.html).toContain(data.settings_url);
  });
});
