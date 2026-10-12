import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getRequestHost,
  getTenantDomainCandidates,
  FORWARDED_HEADER_ENABLED_ENV,
} from "./request-host";

afterEach(() => {
  vi.unstubAllEnvs();
});

const behindEdge = new Headers({
  Host: "store.example",
  "X-Forwarded-Host": "other.example",
});

describe("getRequestHost", () => {
  it.each([undefined, "", "true", "TRUE", "1", "t", " true "])(
    "takes X-Forwarded-Host when the variable is %j",
    (value) => {
      if (value !== undefined) {
        vi.stubEnv(FORWARDED_HEADER_ENABLED_ENV, value);
      }

      expect(getRequestHost(behindEdge)).toBe("other.example");
    }
  );

  it.each(["false", "0", "F"])(
    "takes Host over X-Forwarded-Host when the variable is %j",
    (value) => {
      vi.stubEnv(FORWARDED_HEADER_ENABLED_ENV, value);

      expect(getRequestHost(behindEdge)).toBe("store.example");
    }
  );

  it("takes the value the nearest hop appended", () => {
    expect(
      getRequestHost(
        new Headers({
          Host: "web-storefront:3000",
          "X-Forwarded-Host": "caller.example, store.example",
        })
      )
    ).toBe("store.example");
  });

  it("falls back to Host when the edge sent no X-Forwarded-Host", () => {
    expect(getRequestHost(new Headers({ Host: "store.example" }))).toBe(
      "store.example"
    );
  });

  it("refuses a value it cannot read as a boolean", () => {
    vi.stubEnv(FORWARDED_HEADER_ENABLED_ENV, "yes");

    expect(() => getRequestHost(behindEdge)).toThrow(
      FORWARDED_HEADER_ENABLED_ENV
    );
  });

  it("returns null when no header names a host", () => {
    expect(getRequestHost(new Headers())).toBeNull();
  });
});

describe("getTenantDomainCandidates", () => {
  it("lowercases the host and keeps its port", () => {
    expect(
      getTenantDomainCandidates(new Headers({ Host: "Store.Example.com:443" }))
    ).toEqual(["store.example.com:443"]);
  });

  it("keeps a non-default port instead of also matching the bare hostname", () => {
    expect(
      getTenantDomainCandidates(new Headers({ Host: "shop.example:8443" }))
    ).toEqual(["shop.example:8443"]);
  });

  it("ignores X-Forwarded-Host when the edge passes a caller's on", () => {
    vi.stubEnv(FORWARDED_HEADER_ENABLED_ENV, "false");

    expect(getTenantDomainCandidates(behindEdge)).toEqual(["store.example"]);
  });

  it("returns an empty array when no header is present", () => {
    expect(getTenantDomainCandidates(new Headers())).toEqual([]);
  });
});
