import { describe, expect, it } from "vitest";

import { episodeShownOn } from "./surface-availability";

describe("episodeShownOn", () => {
  it("follows the series when the episode states nothing of its own", () => {
    expect(episodeShownOn("web", "")).toBe("web");
    expect(episodeShownOn("all", "")).toBe("all");
  });

  it("narrows a series on both surfaces to the one the episode names", () => {
    expect(episodeShownOn("all", "app")).toBe("app");
  });

  it("never widens the series past the surface it is kept to", () => {
    expect(episodeShownOn("web", "all")).toBe("web");
  });

  it("shows the episode nowhere when it names the surface its series is kept off", () => {
    expect(episodeShownOn("web", "app")).toBe("none");
    expect(episodeShownOn("app", "web")).toBe("none");
  });
});
