import { describe, expect, it } from "vitest";

import { recordIdSchema } from "./record-id";

describe("recordIdSchema", () => {
  it("trims and accepts a UUID", () => {
    expect(recordIdSchema.parse(" 018f0e6a-1000-7000-8000-000000000001 ")).toBe(
      "018f0e6a-1000-7000-8000-000000000001"
    );
  });

  it("accepts a UUID without RFC version bits, as seeded IDs are", () => {
    expect(recordIdSchema.parse("c4ca4238-a0b9-2382-0dcc-509a6f75849b")).toBe(
      "c4ca4238-a0b9-2382-0dcc-509a6f75849b"
    );
  });

  it("rejects a blank or malformed value", () => {
    for (const value of ["", "SeedSERSAAA1"]) {
      expect(recordIdSchema.safeParse(value).success).toBe(false);
    }
  });
});
