import { afterEach, describe, expect, it } from "vitest";

import { clampTtlSeconds, resolveCacheHandlerConfig } from "./config";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("resolveCacheHandlerConfig", () => {
  it("defaults redis url and key prefix", () => {
    delete process.env.REDIS_URL;
    delete process.env.NEXT_CACHE_KEY_PREFIX;
    delete process.env.NEXT_CACHE_APP;
    delete process.env.NEXT_PHASE;

    const config = resolveCacheHandlerConfig();
    expect(config.redisUrl).toBe("redis://localhost:6379");
    expect(config.keyPrefix).toBe("publira:next:");
  });

  it("disables redis for explicit off values", () => {
    process.env.REDIS_URL = "disabled";
    expect(resolveCacheHandlerConfig().redisUrl).toBe("");

    process.env.REDIS_URL = "off";
    expect(resolveCacheHandlerConfig().redisUrl).toBe("");

    process.env.REDIS_URL = "";
    expect(resolveCacheHandlerConfig().redisUrl).toBe("");
  });

  it("disables redis during production build phase", () => {
    process.env.REDIS_URL = "redis://example:6379";
    process.env.NEXT_PHASE = "phase-production-build";
    expect(resolveCacheHandlerConfig().redisUrl).toBe("");
  });

  it("uses NEXT_CACHE_APP and NEXT_CACHE_KEY_PREFIX", () => {
    delete process.env.NEXT_PHASE;
    process.env.NEXT_CACHE_APP = "web-host";
    expect(resolveCacheHandlerConfig().keyPrefix).toBe("publira:web-host:");

    process.env.NEXT_CACHE_KEY_PREFIX = "custom-prefix";
    expect(resolveCacheHandlerConfig().keyPrefix).toBe("custom-prefix:");
  });
});

describe("clampTtlSeconds", () => {
  const config = resolveCacheHandlerConfig({
    redisUrl: "",
  });

  it("falls back to default and caps at max", () => {
    expect(clampTtlSeconds(undefined, config)).toBe(config.defaultTtlSeconds);
    expect(clampTtlSeconds(0, config)).toBe(config.defaultTtlSeconds);
    expect(clampTtlSeconds(config.maxTtlSeconds + 100, config)).toBe(
      config.maxTtlSeconds
    );
    expect(clampTtlSeconds(120, config)).toBe(120);
  });
});
