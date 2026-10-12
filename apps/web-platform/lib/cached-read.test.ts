import { describe, expect, it } from "vitest";

import { settleCachedRead } from "./cached-read";

describe("settleCachedRead", () => {
  it("returns a result without the verdict", () => {
    expect(settleCachedRead({ ok: true, unexpected: false, value: 1 })).toEqual(
      { ok: true, value: 1 }
    );
  });

  it("returns a failure the screen has copy for", () => {
    expect(settleCachedRead({ message: "Could not load.", ok: false })).toEqual(
      { message: "Could not load.", ok: false }
    );
  });

  it("throws an unexpected failure with its message", () => {
    expect(() =>
      settleCachedRead({
        message: "Could not load.",
        ok: false,
        unexpected: true,
      })
    ).toThrow("Could not load.");
  });
});
