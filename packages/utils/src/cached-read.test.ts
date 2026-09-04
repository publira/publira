import { beforeEach, describe, expect, it, vi } from "vitest";

import { cachedReadFailure, dropFailedCacheEntry } from "./cached-read";

const { mockCacheLife } = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheLife: mockCacheLife,
}));

describe("dropFailedCacheEntry", () => {
  beforeEach(() => {
    mockCacheLife.mockReset();
  });

  it("sets a cacheLife that makes the entry unstorable", () => {
    dropFailedCacheEntry();

    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("does not throw where cacheLife is unavailable, such as a unit test", () => {
    mockCacheLife.mockImplementationOnce(() => {
      throw new Error("outside a cache scope");
    });

    expect(() => dropFailedCacheEntry()).not.toThrow();
  });
});

describe("cachedReadFailure", () => {
  beforeEach(() => {
    mockCacheLife.mockReset();
  });

  it("returns a failure with a message and drops the entry", () => {
    expect(cachedReadFailure("Could not load the data.")).toEqual({
      message: "Could not load the data.",
      ok: false,
    });
    expect(mockCacheLife).toHaveBeenCalledTimes(1);
  });
});
