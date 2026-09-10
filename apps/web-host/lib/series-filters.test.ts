import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  genreFilterSchema,
  seriesFreeFilterSchema,
  seriesListQueryHref,
  seriesOrderSchema,
  seriesStatusFilterSchema,
} from "./series-filters";

const schema = z.object({
  free: seriesFreeFilterSchema,
  genre: genreFilterSchema,
  order: seriesOrderSchema,
  status: seriesStatusFilterSchema,
});

describe("seriesOrderSchema", () => {
  it("Takes the three sorts the control offers", () => {
    expect(seriesOrderSchema.parse("newest")).toBe("newest");
    expect(seriesOrderSchema.parse("updated")).toBe("updated");
    expect(seriesOrderSchema.parse("title")).toBe("title");
  });

  it("An absent, unknown, or repeated value is the newest sort", () => {
    expect(schema.parse({}).order).toBe("newest");
    expect(seriesOrderSchema.parse("published_at_asc")).toBe("newest");
    expect(seriesOrderSchema.parse(["title", "newest"])).toBe("newest");
  });
});

describe("seriesStatusFilterSchema", () => {
  it("Takes the three serialization states", () => {
    expect(seriesStatusFilterSchema.parse("ongoing")).toBe("ongoing");
    expect(seriesStatusFilterSchema.parse("completed")).toBe("completed");
    expect(seriesStatusFilterSchema.parse("hiatus")).toBe("hiatus");
  });

  it("An absent or unknown state applies no filter", () => {
    expect(schema.parse({}).status).toBe("");
    expect(seriesStatusFilterSchema.parse("cancelled")).toBe("");
  });
});

describe("seriesFreeFilterSchema", () => {
  it("Takes what the checkbox submits, and its negatives", () => {
    expect(seriesFreeFilterSchema.parse("1")).toBe(true);
    expect(seriesFreeFilterSchema.parse("on")).toBe(true);
    expect(seriesFreeFilterSchema.parse("0")).toBe(false);
  });

  it("An absent or unreadable value keeps the paid series in", () => {
    expect(schema.parse({}).free).toBe(false);
    expect(seriesFreeFilterSchema.parse("maybe")).toBe(false);
  });
});

describe("genreFilterSchema", () => {
  it("Passes a 12 character Base58 public_id, trimmed", () => {
    expect(genreFilterSchema.parse(" SeedGENRAAA1 ")).toBe("SeedGENRAAA1");
  });

  it("Anything else applies no genre filter", () => {
    expect(schema.parse({}).genre).toBe("");
    expect(genreFilterSchema.parse("not-a-public-id")).toBe("");
    expect(genreFilterSchema.parse("0OOOOOOOOOOO")).toBe("");
    expect(genreFilterSchema.parse(["a", "b"])).toBe("");
  });
});

describe("seriesListQueryHref", () => {
  it("Leaves every default out, so the unnarrowed list has one address", () => {
    expect(
      seriesListQueryHref("/series", { ...schema.parse({}), token: "" })
    ).toBe("/series");
  });

  it("Writes the sort, the filters, and the token in that order", () => {
    expect(
      seriesListQueryHref("/series", {
        ...schema.parse({
          free: "1",
          genre: "SeedGENRAAA1",
          order: "title",
          status: "hiatus",
        }),
        token: "djF8Zg",
      })
    ).toBe(
      "/series?genre=SeedGENRAAA1&order=title&status=hiatus&free=1&token=djF8Zg"
    );
  });

  it("Keeps the screen's own path, which a genre page carries in its URL", () => {
    expect(
      seriesListQueryHref("/genres/SeedGENRAAA1", {
        free: false,
        order: "updated",
        status: "",
        token: "",
      })
    ).toBe("/genres/SeedGENRAAA1?order=updated");
  });
});
