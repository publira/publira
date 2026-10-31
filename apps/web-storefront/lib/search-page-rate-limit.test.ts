import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  createSearchPageLimiter,
  EDGE_SEARCH_PAGE_RATE,
  parseRedisUrl,
  SEARCH_PAGE_LIMIT,
  SEARCH_PAGE_WINDOW_SECONDS,
} from "./search-page-rate-limit";
import type { SharedCounter } from "./search-page-rate-limit";

const WINDOW_MILLISECONDS = SEARCH_PAGE_WINDOW_SECONDS * 1000;

/** A shared store in memory, standing in for the Valkey every instance uses. */
const sharedStore = (): SharedCounter => {
  const counts = new Map<string, number>();

  return (key) => {
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);

    return Promise.resolve(count);
  };
};

const unreachable: SharedCounter = () => Promise.resolve(null);

/** Charges `client` `times` times and answers how many were admitted. */
const admitted = async (
  charge: ReturnType<typeof createSearchPageLimiter>,
  client: string,
  times: number
): Promise<number> => {
  let count = 0;

  for (let index = 0; index < times; index += 1) {
    // oxlint-disable-next-line no-await-in-loop -- each charge reads the count the one before it left
    const decision = await charge(client);

    if (decision.allowed) {
      count += 1;
    }
  }

  return count;
};

describe("createSearchPageLimiter", () => {
  it("Refuse a client past the limit and tell it when the window ends", async () => {
    const at = 7 * WINDOW_MILLISECONDS + 2500;

    const charge = createSearchPageLimiter({
      now: () => at,
      shared: sharedStore(),
    });

    expect(await admitted(charge, "198.51.100.1", SEARCH_PAGE_LIMIT)).toBe(
      SEARCH_PAGE_LIMIT
    );
    expect(await charge("198.51.100.1")).toEqual({
      allowed: false,
      retryAfterSeconds: 8,
    });
  });

  it("Serve another client while one is refused", async () => {
    const charge = createSearchPageLimiter({
      now: () => 0,
      shared: sharedStore(),
    });

    await admitted(charge, "198.51.100.1", SEARCH_PAGE_LIMIT + 1);

    expect(await charge("198.51.100.2")).toEqual({ allowed: true });
  });

  it("Admit the client again once the window has passed", async () => {
    let at = 0;

    const charge = createSearchPageLimiter({
      now: () => at,
      shared: sharedStore(),
    });

    await admitted(charge, "198.51.100.1", SEARCH_PAGE_LIMIT + 1);
    at = WINDOW_MILLISECONDS;

    expect(await charge("198.51.100.1")).toEqual({ allowed: true });
  });

  it("Count one client together on two instances sharing the store", async () => {
    const shared = sharedStore();
    const first = createSearchPageLimiter({ now: () => 0, shared });
    const second = createSearchPageLimiter({ now: () => 0, shared });

    const half = SEARCH_PAGE_LIMIT / 2;

    expect(await admitted(first, "198.51.100.1", half)).toBe(half);
    expect(await admitted(second, "198.51.100.1", half)).toBe(half);

    const [fromFirst, fromSecond] = [
      await first("198.51.100.1"),
      await second("198.51.100.1"),
    ];

    expect(fromFirst.allowed).toBe(false);
    expect(fromSecond.allowed).toBe(false);
  });

  it("Keep limiting in the process when the shared store is unreachable", async () => {
    const charge = createSearchPageLimiter({
      now: () => 0,
      shared: unreachable,
    });

    expect(await admitted(charge, "198.51.100.1", SEARCH_PAGE_LIMIT + 1)).toBe(
      SEARCH_PAGE_LIMIT
    );
  });

  it("Keep limiting in the process when the shared store fails", async () => {
    const charge = createSearchPageLimiter({
      now: () => 0,
      shared: () => Promise.reject(new Error("PNCH_REDIS_URL is malformed")),
    });

    expect(await admitted(charge, "198.51.100.1", SEARCH_PAGE_LIMIT + 1)).toBe(
      SEARCH_PAGE_LIMIT
    );
  });

  it("Key the shared counter by the window and the client, expiring at the window's end", async () => {
    const calls: [string, number][] = [];

    const charge = createSearchPageLimiter({
      now: () => 3 * WINDOW_MILLISECONDS + 9001,
      shared: (key, ttlSeconds) => {
        calls.push([key, ttlSeconds]);

        return Promise.resolve(1);
      },
    });

    await charge("reader");

    expect(calls).toEqual([["3:reader", 1]]);
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

describe("parseRedisUrl", () => {
  it.each([undefined, "", " ", "disabled", "OFF", "false"])(
    "Count in the process alone for %j",
    (raw) => {
      expect(parseRedisUrl(raw)).toBeNull();
    }
  );

  it("Answer the URL it names, trimmed", () => {
    expect(parseRedisUrl(" redis://valkey:6379 ")).toBe("redis://valkey:6379");
    expect(parseRedisUrl("rediss://:secret@valkey:6380")).toBe(
      "rediss://:secret@valkey:6380"
    );
  });

  it("Refuse a password sent over redis://", () => {
    expect(() => parseRedisUrl("redis://:secret@valkey:6379")).toThrow(
      /rediss:\/\//u
    );
  });
});
