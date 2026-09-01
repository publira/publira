import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockResolveSetupCompleted } = vi.hoisted(() => ({
  mockResolveSetupCompleted: vi.fn(),
}));

beforeEach(() => {
  mockResolveSetupCompleted.mockReset();
});

vi.mock("./lib/setup", () => ({
  resolveSetupCompleted: mockResolveSetupCompleted,
}));

describe("web-platform proxy", () => {
  it("returns 404 for GET /logout without setup checks or session operations", async () => {
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("./proxy");

    const response = await proxy(
      new NextRequest("https://platform.example.com/logout", {
        headers: { cookie: "publira_web_platform_auth=tok" },
      })
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(mockResolveSetupCompleted).not.toHaveBeenCalled();
  });

  it("returns 404 for unauthenticated GET /logout without redirecting to login", async () => {
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("./proxy");

    const response = await proxy(
      new NextRequest("https://platform.example.com/logout")
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("location")).toBeNull();
    expect(mockResolveSetupCompleted).not.toHaveBeenCalled();
  });

  it("excludes revalidation paths from the proxy matcher", async () => {
    const { config } = await import("./proxy");

    expect(
      unstable_doesMiddlewareMatch({ config, url: "/api/v1/revalidate" })
    ).toBe(false);
    expect(
      unstable_doesMiddlewareMatch({ config, url: "/api/v1/revalidate/" })
    ).toBe(false);
  });
});
