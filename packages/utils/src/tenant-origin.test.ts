import { afterEach, describe, expect, it, vi } from "vitest";

import { TENANT_URL_SCHEME_ENV, tenantOrigin } from "./tenant-origin";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("tenantOrigin", () => {
  it.each([
    [
      "defaults to https with no port",
      "",
      "store.example",
      "https://store.example",
    ],
    [
      "drops a saved scheme and trailing slash",
      "",
      " https://store.example/ ",
      "https://store.example",
    ],
    [
      "takes the scheme from the environment",
      "http",
      "comics.localhost",
      "http://comics.localhost",
    ],
    [
      "reads the scheme case-insensitively",
      "HTTP",
      "comics.localhost",
      "http://comics.localhost",
    ],
    [
      "keeps a port saved on the domain",
      "http",
      "comics.localhost:3180",
      "http://comics.localhost:3180",
    ],
    [
      "keeps a saved https port under an http scheme",
      "http",
      "store.example:443",
      "http://store.example:443",
    ],
  ])("%s", (_name, scheme, domain, want) => {
    vi.stubEnv(TENANT_URL_SCHEME_ENV, scheme);
    expect(tenantOrigin(domain)).toBe(want);
  });

  it("treats an unset scheme the same as an empty one", () => {
    const previous = process.env.PUBLIRA_TENANT_URL_SCHEME;
    delete process.env.PUBLIRA_TENANT_URL_SCHEME;

    try {
      expect(tenantOrigin("store.example")).toBe("https://store.example");
    } finally {
      if (previous === undefined) {
        delete process.env.PUBLIRA_TENANT_URL_SCHEME;
      } else {
        process.env.PUBLIRA_TENANT_URL_SCHEME = previous;
      }
    }
  });

  it("returns null for a blank domain without reading the environment", () => {
    vi.stubEnv(TENANT_URL_SCHEME_ENV, "ftp");

    expect(tenantOrigin(" / ")).toBeNull();
  });

  it("rejects a scheme other than http or https", () => {
    vi.stubEnv(TENANT_URL_SCHEME_ENV, "ftp");

    expect(() => tenantOrigin("store.example")).toThrow(TENANT_URL_SCHEME_ENV);
  });
});
