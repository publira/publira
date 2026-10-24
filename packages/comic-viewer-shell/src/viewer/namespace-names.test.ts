// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import * as Viewer from ".";

describe("Viewer namespace", () => {
  // A part is renamed only where the subpath exports it, so React DevTools,
  // error overlays, and stack traces keep naming it `ViewerRoot` rather than
  // `Root`, which is also what `@publira/comic-viewer` calls its own root.
  it("keeps each part's declared name", () => {
    for (const [key, part] of Object.entries(Viewer)) {
      expect(typeof part, `Viewer.${key}`).toBe("function");
      expect(part.name, `Viewer.${key}`).not.toBe(key);
    }
  });
});
