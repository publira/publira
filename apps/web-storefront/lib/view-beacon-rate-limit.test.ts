import { describe, expect, it } from "vitest";

import {
  createViewBeaconLimiter,
  VIEW_BEACON_LIMIT,
} from "./view-beacon-rate-limit";

describe("createViewBeaconLimiter", () => {
  it("Admit a client up to VIEW_BEACON_LIMIT in a window", async () => {
    const counts = new Map<string, number>();

    const charge = createViewBeaconLimiter({
      now: () => 0,
      shared: (key) => {
        const count = (counts.get(key) ?? 0) + 1;
        counts.set(key, count);

        return Promise.resolve(count);
      },
    });

    const decisions = [];

    for (let index = 0; index <= VIEW_BEACON_LIMIT; index += 1) {
      // oxlint-disable-next-line no-await-in-loop -- each charge reads the count the one before it left
      decisions.push(await charge("198.51.100.1"));
    }

    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(
      VIEW_BEACON_LIMIT
    );
    expect(decisions.at(-1)?.allowed).toBe(false);
  });
});

describe("VIEW_BEACON_LIMIT", () => {
  it("Admits the 30 in 10 seconds the rate limits page states", () => {
    expect(VIEW_BEACON_LIMIT).toBe(30);
  });
});
