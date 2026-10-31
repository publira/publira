import { describe, expect, it } from "vitest";

import { loadEmailMessages } from "../messages";
import { renderEmail } from "../render";
import { readerEpisodePublishedDataSchema } from "./reader-episode-published";

const data = {
  episode_title: "The First Night",
  episode_url:
    "https://tenant.example.test/series/SERIES000001/episodes/EPISODE00001",
  series_title: "The Lighthouse Keeper",
  settings_url: "https://tenant.example.test/settings/notifications",
  tenant_name: "Aoto Press",
};

describe("readerEpisodePublishedDataSchema", () => {
  it("accepts the variables the sender fills in", () => {
    expect(readerEpisodePublishedDataSchema.parse(data)).toEqual(data);
  });

  it("rejects an episode_url that is not an http(s) URL", () => {
    const parsed = readerEpisodePublishedDataSchema.safeParse({
      ...data,
      episode_url: "ftp://tenant.example.test/episode",
    });

    expect(parsed.success).toBe(false);
  });

  it("requires the episode's title", () => {
    const parsed = readerEpisodePublishedDataSchema.safeParse({
      ...data,
      episode_title: " ",
    });

    expect(parsed.success).toBe(false);
  });
});

describe("ReaderEpisodePublishedEmail", () => {
  it("names the episode and links it and the notification settings", async () => {
    const result = await renderEmail({
      data,
      locale: "en",
      messages: await loadEmailMessages("en"),
      template: "reader_episode_published",
      timeZone: "UTC",
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.html).toContain("A new episode has been published");
    expect(result.html).toContain(data.series_title);
    expect(result.html).toContain(data.episode_title);
    expect(result.html).toContain(data.episode_url);
    expect(result.html).toContain(data.settings_url);
    expect(result.html).toContain(data.tenant_name);
  });

  it("the ja mail comes from the Japanese catalog", async () => {
    const result = await renderEmail({
      data,
      locale: "ja",
      messages: await loadEmailMessages("ja"),
      template: "reader_episode_published",
      timeZone: "UTC",
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.html).toContain("新しいエピソードが公開されました");
  });
});
