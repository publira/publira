import { describe, expect, it } from "vitest";

import { loadPlatformClientMessages } from "./messages";

describe("loadPlatformClientMessages", () => {
  it("carries the console's own namespace and nothing else", async () => {
    const messages = await loadPlatformClientMessages("en");

    expect(Object.keys(messages)).toEqual(["platform"]);
  });
});
