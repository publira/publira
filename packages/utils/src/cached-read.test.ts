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

  it("エントリを保存不可にする cacheLife を設定する", () => {
    dropFailedCacheEntry();

    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("cacheLife が使えない環境（ユニットテスト）でも throw しない", () => {
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

  it("メッセージ付きの失敗を返し、エントリを落とす", () => {
    expect(cachedReadFailure("取得できませんでした。")).toEqual({
      message: "取得できませんでした。",
      ok: false,
    });
    expect(mockCacheLife).toHaveBeenCalledTimes(1);
  });
});
