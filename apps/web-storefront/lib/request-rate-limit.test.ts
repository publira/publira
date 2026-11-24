import { describe, expect, it } from "vitest";

import {
  createRequestRateLimiter,
  parseRedisUrl,
  RATE_LIMIT_WINDOW_SECONDS,
} from "./request-rate-limit";
import type { SharedCounter } from "./request-rate-limit";

const WINDOW_MILLISECONDS = RATE_LIMIT_WINDOW_SECONDS * 1000;

const LIMIT = 6;

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

const limiter = (
  options: Omit<
    Parameters<typeof createRequestRateLimiter>[0],
    "limit" | "name"
  >
) => createRequestRateLimiter({ ...options, limit: LIMIT, name: "test" });

/** Charges `client` `times` times and answers how many were admitted. */
const admitted = async (
  charge: ReturnType<typeof createRequestRateLimiter>,
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

describe("createRequestRateLimiter", () => {
  it("Refuse a client past the limit and tell it when the window ends", async () => {
    const at = 7 * WINDOW_MILLISECONDS + 2500;

    const charge = limiter({ now: () => at, shared: sharedStore() });

    expect(await admitted(charge, "198.51.100.1", LIMIT)).toBe(LIMIT);
    expect(await charge("198.51.100.1")).toEqual({
      allowed: false,
      retryAfterSeconds: 8,
    });
  });

  it("Serve another client while one is refused", async () => {
    const charge = limiter({ now: () => 0, shared: sharedStore() });

    await admitted(charge, "198.51.100.1", LIMIT + 1);

    expect(await charge("198.51.100.2")).toEqual({ allowed: true });
  });

  it("Admit the client again once the window has passed", async () => {
    let at = 0;

    const charge = limiter({ now: () => at, shared: sharedStore() });

    await admitted(charge, "198.51.100.1", LIMIT + 1);
    at = WINDOW_MILLISECONDS;

    expect(await charge("198.51.100.1")).toEqual({ allowed: true });
  });

  it("Count one client together on two instances sharing the store", async () => {
    const shared = sharedStore();
    const first = limiter({ now: () => 0, shared });
    const second = limiter({ now: () => 0, shared });

    const half = LIMIT / 2;

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
    const charge = limiter({ now: () => 0, shared: unreachable });

    expect(await admitted(charge, "198.51.100.1", LIMIT + 1)).toBe(LIMIT);
  });

  it("Keep limiting in the process when the shared store fails", async () => {
    const charge = limiter({
      now: () => 0,
      shared: () => Promise.reject(new Error("PUBLIRA_REDIS_URL is malformed")),
    });

    expect(await admitted(charge, "198.51.100.1", LIMIT + 1)).toBe(LIMIT);
  });

  it("Key the shared counter by the window and the client, expiring at the window's end", async () => {
    const calls: [string, number][] = [];

    const charge = limiter({
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
