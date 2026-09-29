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

    expect(result).toEqual(["store.example.com:443", "cdn.example.com"]);
  });

  it("keeps a non-default port instead of also matching the bare hostname", () => {
    const headers: HeadersLike = {
      get(name: string) {
        if (name === "host") {
          return "shop.example:8443";
        }
        return null;
      },
    };

    expect(getTenantDomainCandidates(headers)).toEqual(["shop.example:8443"]);
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
