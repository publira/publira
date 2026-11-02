import { describe, expect, it } from "vitest";

import { previewPageCountFor } from "./episode-preview";

describe("previewPageCountFor", () => {
  it("keeps the count of a priced episode", () => {
    expect(previewPageCountFor(100, 3)).toBe(3);
  });

  it("stores none on a free episode, whatever the form sent", () => {
    expect(previewPageCountFor(0, 3)).toBe(0);
  });
});
