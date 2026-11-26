import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDeleteCookie, mockGetCookie, mockSetCookie } = vi.hoisted(() => ({
  mockDeleteCookie: vi.fn(),
  mockGetCookie: vi.fn(),
  mockSetCookie: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      delete: mockDeleteCookie,
      get: mockGetCookie,
      set: mockSetCookie,
    }),
  headers: () => Promise.resolve(new Headers()),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("stepUpCallOptions", () => {
  it("sends the step-up token this browser holds beside the session", async () => {
    mockGetCookie.mockReturnValueOnce({ value: " step-up-token " });
    const { stepUpCallOptions } = await import("./step-up");

    await expect(stepUpCallOptions("session-token")).resolves.toEqual({
      headers: {
        Authorization: "Bearer session-token",
        "Publira-Step-Up": "step-up-token",
      },
    });
    expect(mockGetCookie).toHaveBeenCalledWith("publira_web_admin_step_up");
  });

  it("sends the session alone from a browser that holds none", async () => {
    mockGetCookie.mockReturnValueOnce(undefined);
    const { stepUpCallOptions } = await import("./step-up");

    await expect(stepUpCallOptions("session-token")).resolves.toEqual({
      headers: { Authorization: "Bearer session-token" },
    });
  });
});

describe("writeStepUpCookie", () => {
  it("keeps the token in its own cookie, expiring with it", async () => {
    const { writeStepUpCookie } = await import("./step-up");

    await writeStepUpCookie({
      expiresAt: Temporal.Instant.from("2026-11-26T10:15:00Z"),
      token: "step-up-token",
    });

    expect(mockSetCookie).toHaveBeenCalledWith(
      expect.objectContaining({
        httpOnly: true,
        name: "publira_web_admin_step_up",
        value: "step-up-token",
      })
    );
    expect(mockSetCookie.mock.calls[0]?.[0].expires.toISOString()).toBe(
      "2026-11-26T10:15:00.000Z"
    );
  });
});

describe("clearStepUpCookie", () => {
  it("drops the token", async () => {
    const { clearStepUpCookie } = await import("./step-up");

    await clearStepUpCookie();

    expect(mockDeleteCookie).toHaveBeenCalledWith("publira_web_admin_step_up");
  });
});
