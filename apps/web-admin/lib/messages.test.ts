import { describe, expect, it } from "vitest";

import { loadAdminClientMessages } from "./messages";
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

describe("loadAdminClientMessages", () => {
  it("carries the console's own namespace and nothing else", async () => {
    const messages = await loadAdminClientMessages("en");

    expect(Object.keys(messages)).toEqual(["admin"]);
  });
});
