import { describe, expect, it } from "vitest";

import { formatCropRect, isCropRectField, parseCropRect } from "./crop-rect";

describe("formatCropRect", () => {
  it("writes the rectangle as x, y, width and height", () => {
    expect(formatCropRect({ height: 900, width: 1600, x: 578, y: 0 })).toBe(
      "578,0,1600,900"
    );
  });

  it("round-trips through parseCropRect", () => {
    const rect = { height: 1260, width: 2400, x: 0, y: 970 };
    expect(parseCropRect(formatCropRect(rect))).toEqual(rect);
  });
});

describe("parseCropRect", () => {
  it("reads a whole rectangle", () => {
    expect(parseCropRect("10,20,1600,900")).toEqual({
      height: 900,
      width: 1600,
      x: 10,
      y: 20,
    });
  });

  it("reads a rectangle a form padded with whitespace", () => {
    expect(parseCropRect("  10,20,1600,900 ")).toEqual({
      height: 900,
      width: 1600,
      x: 10,
      y: 20,
    });
  });

  it.each([
    ["an empty field", ""],
    ["a rectangle missing a side", "10,20,1600"],
    ["a zero-width rectangle", "10,20,0,900"],
    ["a zero-height rectangle", "10,20,1600,0"],
    ["a negative origin", "-1,20,1600,900"],
    ["a fractional side", "10,20,1600.5,900"],
    ["something that is not a rectangle at all", "centre"],
  ])("reads nothing from %s", (_name, value) => {
    expect(parseCropRect(value)).toBeUndefined();
  });
});

describe("isCropRectField", () => {
  it("accepts an empty field, which frames nothing", () => {
    expect(isCropRectField("   ")).toBe(true);
  });

  it("accepts a whole rectangle", () => {
    expect(isCropRectField("0,0,1200,1600")).toBe(true);
  });

  it("rejects a rectangle that lost a side", () => {
    expect(isCropRectField("0,0,1200")).toBe(false);
  });
});
