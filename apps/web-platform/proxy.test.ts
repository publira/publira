import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockIsSetupCompleted } = vi.hoisted(() => ({
  mockIsSetupCompleted: vi.fn(),
}));

beforeEach(() => {
  mockIsSetupCompleted.mockReset();
});

vi.mock("./lib/setup", () => ({
  isSetupCompleted: mockIsSetupCompleted,
}));

describe("web-platform proxy", () => {
  it("GET /logout は setup 判定もセッション操作もせず 404 を返す", async () => {
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("./proxy");

    const response = await proxy(
      new NextRequest("https://platform.example.com/logout", {
        headers: { cookie: "publira_web_platform_auth=tok" },
      })
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(mockIsSetupCompleted).not.toHaveBeenCalled();
  });

  it("未認証の GET /logout もログインへ送らず 404 を返す", async () => {
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("./proxy");

    const response = await proxy(
      new NextRequest("https://platform.example.com/logout")
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("location")).toBeNull();
    expect(mockIsSetupCompleted).not.toHaveBeenCalled();
  });

  it("再検証パスを proxy matcher から除外する", async () => {
    const { config } = await import("./proxy");

    expect(
      unstable_doesMiddlewareMatch({ config, url: "/api/revalidate" })
    ).toBe(false);
    expect(
      unstable_doesMiddlewareMatch({ config, url: "/api/revalidate/" })
    ).toBe(false);
    expect(
      unstable_doesMiddlewareMatch({ config, url: "/api/revalidate-other" })
    ).toBe(true);
  });
});
