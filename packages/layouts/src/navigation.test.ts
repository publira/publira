import { describe, expect, it } from "vitest";

import { isCurrentPath } from "./navigation";

describe("isCurrentPath", () => {
  it("root は完全一致のみ active", () => {
    expect(isCurrentPath("/", "/")).toBe(true);
    expect(isCurrentPath("/series", "/")).toBe(false);
  });

  it("通常パスは子パスを active と判定する", () => {
    expect(isCurrentPath("/series/EP001", "/series")).toBe(true);
    expect(isCurrentPath("/catalog", "/series")).toBe(false);
  });

  it("より具体的な href が一致する場合は親 href を非activeにする", () => {
    const allHrefs = ["/series", "/series/EP001"];

    expect(isCurrentPath("/series/EP001/edit", "/series", allHrefs)).toBe(
      false
    );
    expect(isCurrentPath("/series/EP001/edit", "/series/EP001", allHrefs)).toBe(
      true
    );
  });
});
