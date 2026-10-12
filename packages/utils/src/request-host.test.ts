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
  Forwarded: 'for=192.0.2.1;host="forwarded.example";proto=https',
  Host: "web-storefront:3000",
  "X-Forwarded-Host": "x-forwarded.example",
});

describe("getRequestHost", () => {
  it.each([undefined, "", "true", "TRUE", "True", "1", "t", "T", " true "])(
    "takes the host= of Forwarded when the variable is %j",
    (value) => {
      if (value !== undefined) {
        vi.stubEnv(FORWARDED_HEADER_ENABLED_ENV, value);
      }

      expect(getRequestHost(behindEdge)).toBe("forwarded.example");
    }
  );

  it.each(["false", "FALSE", "False", "0", "f", "F"])(
    "takes X-Forwarded-Host and ignores Forwarded when the variable is %j",
    (value) => {
      vi.stubEnv(FORWARDED_HEADER_ENABLED_ENV, value);

      expect(getRequestHost(behindEdge)).toBe("x-forwarded.example");
    }
  );

  it("takes the rightmost host= across the elements of Forwarded", () => {
    expect(
      getRequestHost(
        new Headers({
          Forwarded:
            "for=192.0.2.9;host=first.example, for=192.0.2.1;host=store.example",
          Host: "web-storefront:3000",
        })
      )
    ).toBe("store.example");
  });

  it("takes X-Forwarded-Host when Forwarded carries no host=", () => {
    expect(
      getRequestHost(
        new Headers({
          Forwarded: "for=192.0.2.1",
          Host: "web-storefront:3000",
          "X-Forwarded-Host": "store.example",
        })
      )
    ).toBe("store.example");
  });

  it("does not split a quoted host= at a comma or a semicolon", () => {
    expect(
      getRequestHost(
        new Headers({
          Forwarded: 'for="[2001:db8::1]:443";HOST="store.example"',
          Host: "web-storefront:3000",
        })
      )
    ).toBe("store.example");
  });

  it("takes the X-Forwarded-Host value the nearest hop appended", () => {
    expect(
      getRequestHost(
        new Headers({
          Host: "web-storefront:3000",
          "X-Forwarded-Host": "caller.example, store.example",
        })
      )
    ).toBe("store.example");
  });

  it("falls back to Host when the edge described nothing", () => {
    expect(getRequestHost(new Headers({ Host: "store.example" }))).toBe(
      "store.example"
    );
  });

  it.each(["yes", "on", "tRuE", "fAlse"])(
    "refuses %j, which Go's strconv.ParseBool cannot read either",
    (value) => {
      vi.stubEnv(FORWARDED_HEADER_ENABLED_ENV, value);

      expect(() => getRequestHost(behindEdge)).toThrow(
        FORWARDED_HEADER_ENABLED_ENV
      );
    }
  );

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

  it("normalizes the host the edge named", () => {
    expect(
      getTenantDomainCandidates(
        new Headers({
          Forwarded: "host=Store.Example:8443",
          Host: "web-storefront:3000",
        })
      )
    ).toEqual(["store.example:8443"]);
  });

  it("returns an empty array when no header is present", () => {
    expect(getTenantDomainCandidates(new Headers())).toEqual([]);
  });
});
