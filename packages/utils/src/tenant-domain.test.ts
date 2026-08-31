import { describe, expect, it } from "vitest";

import { getTenantDomainCandidates } from "./tenant-domain";

type HeadersLike = Pick<Headers, "get">;

describe("getTenantDomainCandidates", () => {
  it("returns deduplicated candidates from the forwarded host and the host", () => {
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

  it("returns an empty array when no header is present", () => {
    const headers: HeadersLike = {
      get() {
        return null;
      },
    };

    expect(getTenantDomainCandidates(headers)).toEqual([]);
  });
});
