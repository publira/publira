import { describe, expect, it } from "vitest";

import { parseEditTab } from "./edit-tab-search-params";

describe("parseEditTab", () => {
  it("keeps a known tab", () => {
    expect(parseEditTab({ tab: "eye-catch" })).toBe("eye-catch");
    expect(parseEditTab({ tab: "basic" })).toBe("basic");
  });

  it("falls back to basic for a missing, unknown, or conflicting value", () => {
    expect(parseEditTab({})).toBe("basic");
    expect(parseEditTab({ tab: "images" })).toBe("basic");
    expect(parseEditTab({ tab: ["basic", "eye-catch"] })).toBe("basic");
  });
});
