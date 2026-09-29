import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockForbidden, mockHeaders } = vi.hoisted(() => ({
  mockForbidden: vi.fn(),
  mockHeaders: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: mockHeaders }));
vi.mock("next/navigation", () => ({ forbidden: mockForbidden }));

const requestHeaders = (values: Record<string, string>): Headers =>
  new Headers(values);

describe("assertSameOrigin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts an Origin that matches Host", async () => {
    mockHeaders.mockResolvedValue(
      requestHeaders({
        Host: "platform.example.com",
        Origin: "https://platform.example.com",
      })
    );

    const { assertSameOrigin } = await import("./csrf");
    await assertSameOrigin();

    expect(mockForbidden).not.toHaveBeenCalled();
  });

  it("uses Referer when Origin is unavailable", async () => {
    mockHeaders.mockResolvedValue(
      requestHeaders({
        Host: "platform.example.com",
        Referer: "https://platform.example.com/settings",
      })
    );

    const { assertSameOrigin } = await import("./csrf");
    await assertSameOrigin();

    expect(mockForbidden).not.toHaveBeenCalled();
  });

  it("uses X-Forwarded-Host when a reverse proxy supplies the public host", async () => {
    mockHeaders.mockResolvedValue(
      requestHeaders({
        Host: "web-platform:4100",
        Origin: "https://platform.example.com",
        "X-Forwarded-Host": "platform.example.com",
      })
    );

    const { assertSameOrigin } = await import("./csrf");
    await assertSameOrigin();

    expect(mockForbidden).not.toHaveBeenCalled();
  });

  it.each([
    [
      "a mismatched Origin",
      { Host: "platform.example.com", Origin: "https://evil.example" },
    ],
    [
      "a malformed Origin",
      { Host: "platform.example.com", Origin: "not a URL" },
    ],
    ["no Origin or Referer", { Host: "platform.example.com" }],
    [
      "a cross-site Referer",
      {
        Host: "platform.example.com",
        Referer: "https://evil.example/form",
      },
    ],
  ])("rejects %s", async (_label, values) => {
    mockHeaders.mockResolvedValue(requestHeaders(values));

    const { assertSameOrigin } = await import("./csrf");
    await assertSameOrigin();

    expect(mockForbidden).toHaveBeenCalledTimes(1);
  });
});
