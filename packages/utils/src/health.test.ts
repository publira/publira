import { afterEach, describe, expect, it, vi } from "vitest";

import {
  checkUpstreamReadyz,
  createLivezResponse,
  createReadyzResponse,
  HEALTH_STATUS_ERROR,
  HEALTH_STATUS_OK,
  HEALTH_STATUS_STARTING,
  HEALTH_STATUS_UNAVAILABLE,
  isHealthProbePath,
} from "./health";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("createLivezResponse", () => {
  it("returns plain ok with no-store", async () => {
    const response = createLivezResponse();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8"
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("ok");
  });
});

describe("createReadyzResponse", () => {
  it("returns 200 when all checks pass", async () => {
    const response = await createReadyzResponse([
      {
        check: () => Promise.resolve(),
        name: "api",
      },
    ]);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      checks: { api: { status: HEALTH_STATUS_OK } },
      status: HEALTH_STATUS_OK,
    });
  });

  it("returns 503 with error category when a check fails", async () => {
    const response = await createReadyzResponse([
      {
        check: () => Promise.reject(new Error("connection refused")),
        name: "api",
      },
    ]);
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.status).toBe(HEALTH_STATUS_UNAVAILABLE);
    expect(body.checks.api).toEqual({
      error: "connection refused",
      status: HEALTH_STATUS_ERROR,
    });
  });

  it("returns starting when readiness gate is closed", async () => {
    const response = await createReadyzResponse([], { ready: () => false });
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.status).toBe(HEALTH_STATUS_STARTING);
  });
});

describe("checkUpstreamReadyz", () => {
  it("resolves when upstream returns 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response('{"status":"ok"}', { status: 200 }))
    );
    await expect(
      checkUpstreamReadyz("http://api.example:8100")
    ).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith(
      new URL("http://api.example:8100/readyz"),
      expect.objectContaining({ method: "GET" })
    );
  });

  it("rejects when upstream returns non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("no", { status: 503 }))
    );
    await expect(
      checkUpstreamReadyz("http://api.example:8100")
    ).rejects.toThrow(/HTTP 503/u);
  });

  it("rejects empty base URL", async () => {
    await expect(checkUpstreamReadyz("  ")).rejects.toThrow(/not configured/u);
  });
});

describe("isHealthProbePath", () => {
  it("matches livez and readyz only", () => {
    expect(isHealthProbePath("/livez")).toBe(true);
    expect(isHealthProbePath("/readyz")).toBe(true);
    expect(isHealthProbePath("/healthz")).toBe(false);
    expect(isHealthProbePath("/login")).toBe(false);
  });
});
