import { describe, expect, it } from "vitest";

import {
  buildVersionDiff,
  getDefaultComparisonVersionId,
} from "./version-diff";

describe("buildVersionDiff", () => {
  it("added と removed を行単位で返す", () => {
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
  it("公開版があるときは公開版を優先する", () => {
    const versions = [{ id: "latest" }, { id: "published" }, { id: "older" }];

    expect(getDefaultComparisonVersionId("published", versions)).toBe(
      "published"
    );
  });

  it("公開版が先頭なら 2 件目を返す", () => {
    const versions = [{ id: "published" }, { id: "older" }];

    expect(getDefaultComparisonVersionId("published", versions)).toBe("older");
  });
});
