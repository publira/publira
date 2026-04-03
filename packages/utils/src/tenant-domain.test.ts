import { describe, expect, it } from "vitest";

import { getTenantDomainCandidates } from "./tenant-domain";

type HeadersLike = Pick<Headers, "get">;

describe("getTenantDomainCandidates", () => {
  it("forwarded host と host から重複除去した候補を返す", () => {
    const headers: HeadersLike = {
      get(name: string) {
        if (name === "x-forwarded-host") {
          return "Store.Example.com:443, cdn.example.com";
        }
        if (name === "host") {
          return "store.example.com:443";
        }
        return null;
      },
    };

    const result = getTenantDomainCandidates(headers);

    expect(result).toContain("store.example.com:443");
    expect(result).toContain("store.example.com");
    expect(result).toContain("cdn.example.com");
    expect(new Set(result).size).toBe(result.length);
  });

  it("ヘッダーが無い場合は空配列を返す", () => {
    const headers: HeadersLike = {
      get() {
        return null;
      },
    };

    expect(getTenantDomainCandidates(headers)).toEqual([]);
  });
});
