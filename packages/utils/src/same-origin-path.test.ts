import { describe, expect, it } from "vitest";

import { isSameOriginPath } from "./same-origin-path";

describe("isSameOriginPath", () => {
  it("accepts a path on this origin, with its query and fragment", () => {
    expect(isSameOriginPath("/")).toBe(true);
    expect(isSameOriginPath("/series/S001")).toBe(true);
    expect(isSameOriginPath("/search?q=a%2Fb#results")).toBe(true);
    expect(isSameOriginPath("/search?q=a\\b")).toBe(true);
    expect(isSameOriginPath("/../../evil.example")).toBe(true);
  });

  it("refuses a value that is not a path", () => {
    expect(isSameOriginPath("")).toBe(false);
    expect(isSameOriginPath("series")).toBe(false);
    expect(isSameOriginPath("?page=2")).toBe(false);
    expect(isSameOriginPath("#comments")).toBe(false);
    expect(isSameOriginPath("https://evil.example/")).toBe(false);
  });

  it("refuses the shapes a browser resolves to another origin", () => {
    expect(isSameOriginPath("//evil.example")).toBe(false);
    expect(isSameOriginPath("/\\evil.example")).toBe(false);
    expect(isSameOriginPath("/\t/evil.example")).toBe(false);
    expect(isSameOriginPath("/\n/evil.example")).toBe(false);
    expect(isSameOriginPath("/\r/evil.example")).toBe(false);
  });

  it("refuses a control character anywhere and a backslash in the path", () => {
    expect(isSameOriginPath("/series\u0000")).toBe(false);
    expect(isSameOriginPath("/series?q=\u007F")).toBe(false);
    expect(isSameOriginPath("/series\\S001")).toBe(false);
  });
});
