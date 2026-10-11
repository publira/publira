import { describe, expect, it } from "vitest";

import {
  isNarrowedTagSeries,
  parseTagDetailParams,
  parseTagDetailSearchParams,
  tagDetailHref,
  tagDetailPath,
} from "./search-params";

describe("parseTagDetailParams", () => {
  it("Pass a slug of hyphen-joined runs, trimmed", () => {
    expect(parseTagDetailParams({ tag_slug: " time-travel " })).toBe(
      "time-travel"
    );
  });

  it("Letters of every script survive, because a slug is not a path slug", () => {
    expect(parseTagDetailParams({ tag_slug: "恋愛" })).toBe("恋愛");
  });

  it("Set a slug of a shape catalogslug never produces to null", () => {
    expect(parseTagDetailParams({ tag_slug: "-time-travel" })).toBeNull();
    expect(parseTagDetailParams({ tag_slug: "time--travel" })).toBeNull();
    expect(parseTagDetailParams({ tag_slug: "time travel" })).toBeNull();
    expect(parseTagDetailParams({ tag_slug: "../series" })).toBeNull();
    expect(parseTagDetailParams({ tag_slug: "" })).toBeNull();
  });
});

describe("parseTagDetailSearchParams", () => {
  it("With nothing in the query, the tag is the newest page one, unnarrowed", () => {
    expect(parseTagDetailSearchParams({})).toEqual({
      free: false,
      order: "newest",
      status: "",
      token: "",
    });
  });

  it("Reads the sort and the two filters this screen still offers", () => {
    expect(
      parseTagDetailSearchParams({
        free: "1",
        order: "title",
        status: "ongoing",
        token: " djF8Zg-_ ",
      })
    ).toEqual({
      free: true,
      order: "title",
      status: "ongoing",
      token: "djF8Zg-_",
    });
  });
});

describe("isNarrowedTagSeries", () => {
  it("The sort alone is not a filter", () => {
    expect(
      isNarrowedTagSeries(parseTagDetailSearchParams({ order: "title" }))
    ).toBe(false);
  });

  it("Either filter narrows the tag", () => {
    expect(isNarrowedTagSeries(parseTagDetailSearchParams({ free: "1" }))).toBe(
      true
    );
    expect(
      isNarrowedTagSeries(parseTagDetailSearchParams({ status: "completed" }))
    ).toBe(true);
  });
});

describe("tagDetailPath", () => {
  it("Encodes the segment, which may hold letters of any script", () => {
    expect(tagDetailPath("time-travel")).toBe("/tags/time-travel");
    expect(tagDetailPath("恋愛")).toBe("/tags/%E6%81%8B%E6%84%9B");
  });
});

describe("tagDetailHref", () => {
  it("Construct a query under the tag's own path", () => {
    expect(
      tagDetailHref(
        "time-travel",
        parseTagDetailSearchParams({ free: "1", token: "djF8Zg" })
      )
    ).toBe("/tags/time-travel?free=1&token=djF8Zg");
  });

  it("The unnarrowed newest page one is the bare path", () => {
    expect(tagDetailHref("time-travel", parseTagDetailSearchParams({}))).toBe(
      "/tags/time-travel"
    );
  });
});
