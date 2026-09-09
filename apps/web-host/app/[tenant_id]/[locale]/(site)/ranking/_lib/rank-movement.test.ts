import { describe, expect, it } from "vitest";

import { rankMovement } from "./rank-movement";

describe("rankMovement", () => {
  it("reads a better previous position as a climb, by the distance between them", () => {
    expect(rankMovement(2, 7)).toEqual({ kind: "up", steps: 5 });
  });

  it("reads a worse previous position as a fall", () => {
    expect(rankMovement(9, 4)).toEqual({ kind: "down", steps: 5 });
  });

  it("reports an unchanged position as no movement", () => {
    expect(rankMovement(3, 3)).toEqual({ kind: "same" });
  });

  it("treats a missing previous position as a new entry, not as a climb from zero", () => {
    expect(rankMovement(1)).toEqual({ kind: "new" });
  });

  it("treats a previous position of zero as a new entry, since positions count from one", () => {
    expect(rankMovement(4, 0)).toEqual({ kind: "new" });
  });
});
