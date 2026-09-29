import { describe, expect, it } from "vitest";

import { isCurrentPath } from "./navigation";

describe("isCurrentPath", () => {
  it("root is active only on an exact match", () => {
    expect(isCurrentPath("/", "/")).toBe(true);
    expect(isCurrentPath("/series", "/")).toBe(false);
  });

  it("an ordinary path counts its child paths as active", () => {
    expect(isCurrentPath("/series/EP001", "/series")).toBe(true);
    expect(isCurrentPath("/catalog", "/series")).toBe(false);
  });

  it("a matching, more specific href leaves the parent href inactive", () => {
    const allHrefs = ["/series", "/series/EP001"];

    expect(isCurrentPath("/series/EP001/edit", "/series", allHrefs)).toBe(
      false
    );
    expect(isCurrentPath("/series/EP001/edit", "/series/EP001", allHrefs)).toBe(
      true
    );
  });
});
