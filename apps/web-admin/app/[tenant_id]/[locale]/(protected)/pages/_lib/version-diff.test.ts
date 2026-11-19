import { describe, expect, it } from "vitest";

import {
  buildVersionDiff,
  getDefaultComparisonVersionId,
} from "./version-diff";

describe("buildVersionDiff", () => {
  it("returns the added and the removed lines", () => {
    const result = buildVersionDiff(
      ["# Title", "", "new line", "last"].join("\n"),
      ["# Title", "", "old line", "last"].join("\n")
    );

    expect(result.summary.added).toBe(1);
    expect(result.summary.removed).toBe(1);
    expect(result.lines).toEqual([
      { type: "unchanged", value: "# Title" },
      { type: "unchanged", value: "" },
      { type: "removed", value: "old line" },
      { type: "added", value: "new line" },
      { type: "unchanged", value: "last" },
    ]);
  });
});

describe("getDefaultComparisonVersionId", () => {
  it("prefers the published version when there is one", () => {
    const versions = [{ id: "latest" }, { id: "published" }, { id: "older" }];

    expect(getDefaultComparisonVersionId("published", versions)).toBe(
      "published"
    );
  });

  it("returns the second entry when the published version comes first", () => {
    const versions = [{ id: "published" }, { id: "older" }];

    expect(getDefaultComparisonVersionId("published", versions)).toBe("older");
  });
});
