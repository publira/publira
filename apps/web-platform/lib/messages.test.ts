import { describe, expect, it } from "vitest";

import { loadPlatformClientMessages } from "./messages";

describe("loadPlatformClientMessages", () => {
  it("carries the console's own namespace and nothing else, with its locale", async () => {
    const messages = await loadPlatformClientMessages("en");

    expect(Object.keys(messages.catalog)).toEqual(["platform"]);
    expect(messages.locale).toBe("en");
  });
});
