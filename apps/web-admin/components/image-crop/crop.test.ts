import { describe, expect, it } from "vitest";

import { EYE_CATCH_ASPECTS } from "#components/eye-catch/aspects";

import type { CropAspect } from "./crop";
import {
  centreCropRect,
  cropBounds,
  moveCropRect,
  resizeCropRectBy,
  resizeCropRectToPointer,
} from "./crop";

const aspectOf = (variantType: string): CropAspect => {
  const aspect = EYE_CATCH_ASPECTS.find(
    (candidate) => candidate.variantType === variantType
  );
  if (!aspect) {
    throw new Error(`no ${variantType} ratio`);
  }
  return aspect;
};

const landscape = aspectOf("landscape");
const portrait = aspectOf("portrait");

describe("centreCropRect", () => {
  /**
   * These are `centerCropToAspect` in `server/internal/imageproc` worked
   * through by hand, rounding included. They are the cut an upload carrying no
   * rectangle gets, so a frame nobody touched has to reproduce them exactly.
   */
  it.each([
    ["landscape", "wider than the ratio", 4000, 1600, 578, 0, 2844, 1600],
    ["landscape", "narrower than the ratio", 2400, 3200, 0, 925, 2400, 1350],
    ["portrait", "already the ratio", 2400, 3200, 0, 0, 2400, 3200],
    ["square", "taller than wide", 2400, 3200, 0, 400, 2400, 2400],
    ["og", "taller than wide", 2400, 3200, 0, 970, 2400, 1260],
  ])(
    "centres a %s frame in a source %s",
    (variantType, _shape, width, height, x, y, cropWidth, cropHeight) => {
      expect(centreCropRect({ height, width }, aspectOf(variantType))).toEqual({
        height: cropHeight,
        width: cropWidth,
        x,
        y,
      });
    }
  );

  it("keeps the frame inside a source of the exact ratio", () => {
    expect(centreCropRect({ height: 900, width: 1600 }, landscape)).toEqual({
      height: 900,
      width: 1600,
      x: 0,
      y: 0,
    });
  });
});

describe("moveCropRect", () => {
  const bounds = cropBounds({ height: 3200, width: 2400 }, landscape);
  const frame = bounds.largest;

  it("puts the frame where it was dragged", () => {
    expect(moveCropRect(frame, bounds, 0, 100)).toMatchObject({ x: 0, y: 100 });
  });

  it("stops the frame at the top-left corner of the image", () => {
    expect(moveCropRect(frame, bounds, -500, -500)).toMatchObject({
      x: 0,
      y: 0,
    });
  });

  it("stops the frame at the bottom-right corner of the image", () => {
    expect(moveCropRect(frame, bounds, 9999, 9999)).toMatchObject({
      x: bounds.source.width - frame.width,
      y: bounds.source.height - frame.height,
    });
  });

  it("leaves the frame's size alone", () => {
    const moved = moveCropRect(frame, bounds, 0, 100);
    expect(moved.width).toBe(frame.width);
    expect(moved.height).toBe(frame.height);
  });
});

describe("resizeCropRectToPointer", () => {
  const bounds = cropBounds({ height: 3200, width: 2400 }, landscape);
  const { largest } = bounds;

  it("keeps the corner opposite the dragged one where it is", () => {
    const resized = resizeCropRectToPointer(largest, bounds, "se", {
      x: 1600,
      y: largest.y + 900,
    });
    expect(resized).toMatchObject({ x: largest.x, y: largest.y });
    expect(resized.width).toBeLessThan(largest.width);
  });

  it("moves the frame's origin when a top-left corner is dragged", () => {
    const resized = resizeCropRectToPointer(largest, bounds, "nw", {
      x: 400,
      y: 1000,
    });
    expect(resized.x + resized.width).toBe(largest.x + largest.width);
    expect(resized.y + resized.height).toBe(largest.y + largest.height);
  });

  it("keeps the ratio the frame is locked to", () => {
    const resized = resizeCropRectToPointer(largest, bounds, "se", {
      x: 1800,
      y: largest.y + 1012,
    });
    expect(resized.width / resized.height).toBeCloseTo(16 / 9, 2);
  });

  it("refuses to shrink the frame below the ratio's minimum", () => {
    const resized = resizeCropRectToPointer(largest, bounds, "se", {
      x: largest.x + 1,
      y: largest.y + 1,
    });
    expect(resized.width).toBe(landscape.minWidth);
  });

  it("refuses to grow the frame past the image", () => {
    const resized = resizeCropRectToPointer(largest, bounds, "se", {
      x: 99_999,
      y: 99_999,
    });
    expect(resized.width).toBe(largest.width);
    expect(resized.x + resized.width).toBeLessThanOrEqual(bounds.source.width);
    expect(resized.y + resized.height).toBeLessThanOrEqual(
      bounds.source.height
    );
  });

  it("offers the whole image when the image cannot hold the ratio's minimum", () => {
    // Below portrait's 1200x1600 minimum: there is nothing narrower to pick,
    // and the API refuses the upload for the image rather than the selection.
    const small = cropBounds({ height: 800, width: 600 }, portrait);
    const resized = resizeCropRectToPointer(small.largest, small, "se", {
      x: 0,
      y: 0,
    });
    expect(resized.width).toBe(small.largest.width);
  });
});

describe("resizeCropRectBy", () => {
  const bounds = cropBounds({ height: 3200, width: 2400 }, landscape);
  const { largest } = bounds;
  const shrunk = resizeCropRectBy(largest, bounds, "se", -400);

  it("takes the requested pixels off the frame", () => {
    expect(shrunk.width).toBe(largest.width - 400);
  });

  it("grows the frame back from the same corner", () => {
    expect(resizeCropRectBy(shrunk, bounds, "se", 400)).toEqual(largest);
  });
});
