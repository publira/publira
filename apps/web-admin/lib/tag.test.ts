import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCacheLife, mockCacheTag, mockListPublishedTags } = vi.hoisted(
  () => ({
    mockCacheLife: vi.fn(),
    mockCacheTag: vi.fn(),
    mockListPublishedTags: vi.fn(),
  })
);

vi.mock("next/cache", () => ({
  cacheLife: mockCacheLife,
  cacheTag: mockCacheTag,
}));

vi.mock("./public-api", () => ({
  publicApiClient: {
    catalog: {
      listPublishedTags: mockListPublishedTags,
    },
  },
}));

describe("listTagSuggestions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("follows the cursor and keeps the names the tenant's series carry", async () => {
    mockListPublishedTags
      .mockResolvedValueOnce({
        nextToken: "page-2",
        tags: [
          { name: "seaside", slug: "seaside" },
          { name: " ", slug: "" },
        ],
      })
      .mockResolvedValueOnce({
        nextToken: "",
        tags: [{ name: "letterpress", slug: "letterpress" }],
      });

    const { listTagSuggestions } = await import("./tag");
    const result = await listTagSuggestions("TENANT001", "en");

    expect(result).toEqual({
      ok: true,
      tagNames: ["seaside", "letterpress"],
    });
    expect(mockListPublishedTags).toHaveBeenCalledTimes(2);
  });

  // A save that coins a tag drops this tag, so the next series is offered it.
  it("files the suggestions under the tenant series list tag", async () => {
    mockListPublishedTags.mockResolvedValue({ nextToken: "", tags: [] });

    const { listTagSuggestions } = await import("./tag");
    await listTagSuggestions("TENANT001", "en");

    expect(mockCacheTag).toHaveBeenCalledWith("tenant:TENANT001:series:list");
  });

  // The read cannot rethrow — a `"use cache"` fill that throws fails the whole
  // request — so it reports the failure and keeps the entry out of the cache.
  it("reports a failed read instead of throwing, and does not cache it", async () => {
    mockListPublishedTags.mockRejectedValue(
      new ConnectError("unavailable", Code.Unavailable)
    );

    const { listTagSuggestions } = await import("./tag");
    const result = await listTagSuggestions("TENANT001", "en");

    expect(result.ok).toBe(false);
    expect(result.tagNames).toEqual([]);
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });
});
