import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  createSearchPageLimiter,
  EDGE_SEARCH_PAGE_RATE,
  SEARCH_PAGE_LIMIT,
} from "./search-page-rate-limit";

describe("createSearchPageLimiter", () => {
  it("Admit a client up to SEARCH_PAGE_LIMIT in a window", async () => {
    const counts = new Map<string, number>();

    const charge = createSearchPageLimiter({
      now: () => 0,
      shared: (key) => {
        const count = (counts.get(key) ?? 0) + 1;
        counts.set(key, count);

        return Promise.resolve(count);
      },
    });

    const decisions = [];

    for (let index = 0; index <= SEARCH_PAGE_LIMIT; index += 1) {
      // oxlint-disable-next-line no-await-in-loop -- each charge reads the count the one before it left
      decisions.push(await charge("198.51.100.1"));
    }

    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(
      SEARCH_PAGE_LIMIT
    );
    expect(decisions.at(-1)?.allowed).toBe(false);
  });
});

describe("SEARCH_PAGE_LIMIT", () => {
  it("Is the edge's allowance for the search page in the routing contract", async () => {
    const readme = await readFile(
      new URL("../../../infra/proxy/README.md", import.meta.url),
      "utf-8"
    );

    const row = readme
      .split("\n")
      .map((line) => line.slice(2, -2).split(" | "))
      .find(
        (cells) =>
          cells.length === 4 &&
          cells[0]?.startsWith("`/search`, with or without a locale prefix")
      );

    expect(row?.slice(2).map(Number)).toEqual([
      EDGE_SEARCH_PAGE_RATE.burst,
      EDGE_SEARCH_PAGE_RATE.perSecond,
    ]);
  });

  it("Admits the 80 in 10 seconds the rate limits page states", () => {
    expect(SEARCH_PAGE_LIMIT).toBe(80);
  });
});
