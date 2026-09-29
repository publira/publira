import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  parseRouteParams,
  routeParamString,
  routeParamStringArray,
} from "./route-params";
import { STATIC_PARAM_PLACEHOLDER } from "./static-param-placeholder";

describe("routeParamString", () => {
  it("trims and passes a single segment through", () => {
    expect(routeParamString().parse("  series_1  ")).toBe("series_1");
  });

  it("rejects empty, whitespace-only, and non-string values", () => {
    expect(routeParamString().safeParse("").success).toBe(false);
    expect(routeParamString().safeParse("   ").success).toBe(false);
    expect(routeParamString().safeParse(["only"]).success).toBe(false);
    expect(routeParamString().safeParse(42).success).toBe(false);
    expect(z.object({ id: routeParamString() }).safeParse({}).success).toBe(
      false
    );
  });

  it("rejects an over-long value", () => {
    expect(routeParamString({ maxLength: 4 }).safeParse("abcde").success).toBe(
      false
    );
    expect(routeParamString().safeParse("a".repeat(256)).success).toBe(false);
  });

  it("rejects the generateStaticParams placeholder", () => {
    expect(routeParamString().safeParse(STATIC_PARAM_PLACEHOLDER).success).toBe(
      false
    );
  });
});

describe("routeParamStringArray", () => {
  it("trims each catch-all segment", () => {
    expect(routeParamStringArray().parse([" legal ", " terms "])).toEqual([
      "legal",
      "terms",
    ]);
  });

  it("rejects a missing, empty, or non-array value", () => {
    expect(routeParamStringArray().safeParse([]).success).toBe(false);
    expect(routeParamStringArray().safeParse("privacy").success).toBe(false);
    expect(
      z.object({ slug: routeParamStringArray() }).safeParse({}).success
    ).toBe(false);
  });

  it("rejects an empty, placeholder, or over-long segment", () => {
    expect(routeParamStringArray().safeParse(["ok", "  "]).success).toBe(false);
    expect(
      routeParamStringArray().safeParse([STATIC_PARAM_PLACEHOLDER]).success
    ).toBe(false);
    expect(
      routeParamStringArray({ maxLength: 4 }).safeParse(["abcde"]).success
    ).toBe(false);
  });

  it("rejects more segments than maxItems", () => {
    expect(
      routeParamStringArray({ maxItems: 2 }).safeParse(["a", "b", "c"]).success
    ).toBe(false);
  });
});

describe("parseRouteParams", () => {
  const schema = z.object({
    series_id: routeParamString(),
  });

  it("returns the parsed params object", () => {
    expect(
      parseRouteParams(schema, {
        series_id: " series_1 ",
        tenant_id: "ignored",
      })
    ).toEqual({ series_id: "series_1" });
  });

  it("returns null when any segment is invalid", () => {
    expect(parseRouteParams(schema, { series_id: "" })).toBeNull();
    expect(parseRouteParams(schema, {})).toBeNull();
    expect(
      parseRouteParams(schema, { series_id: STATIC_PARAM_PLACEHOLDER })
    ).toBeNull();
  });
});
