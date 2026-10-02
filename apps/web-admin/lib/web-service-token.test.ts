import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveWebServiceToken } from "./web-service-token";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveWebServiceToken", () => {
  it("answers the configured token", () => {
    vi.stubEnv("PUBLIRA_WEB_SERVICE_TOKEN", " service-token ");

    expect(resolveWebServiceToken()).toBe("service-token");
  });

  it.each([
    ["unset", undefined],
    ["blank", "  "],
  ])("refuses a token that is %s", (_, value) => {
    vi.stubEnv("PUBLIRA_WEB_SERVICE_TOKEN", value);

    expect(() => resolveWebServiceToken()).toThrow(
      /PUBLIRA_WEB_SERVICE_TOKEN is not set/u
    );
  });
});
