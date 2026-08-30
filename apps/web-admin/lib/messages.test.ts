import { describe, expect, it } from "vitest";

import type { AdminMessageKey } from "./messages";

const contentEntryMessageKeys = [
  "admin.creators.back_to_list",
  "admin.labels.back_to_list",
  "admin.pages.back_to_list",
  "admin.series.back_to_list",
] as const satisfies readonly AdminMessageKey[];

describe("AdminMessageKey", () => {
  it("includes the content-entry catalog keys", () => {
    expect(contentEntryMessageKeys).toHaveLength(4);
  });
});
