import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { submitContactMessage } from "./contact";

const { mockHeaders, mockResolveAccessToken, mockSubmitContactMessage } =
  vi.hoisted(() => ({
    mockHeaders: vi.fn(),
    mockResolveAccessToken: vi.fn(),
    mockSubmitContactMessage: vi.fn(),
  }));

vi.mock("next/headers", () => ({ headers: mockHeaders }));

vi.mock("./api-client", () => ({
  apiClient: {
    contact: { submitContactMessage: mockSubmitContactMessage },
  },
  resolveAccessToken: mockResolveAccessToken,
}));

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const input = {
  body: "My date of birth is wrong.",
  locale: "en",
  replyToEmail: "reader@example.com",
  subject: "Date of birth",
  tenantId,
} as const;

describe("submitContactMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHeaders.mockResolvedValue(new Headers());
    mockSubmitContactMessage.mockResolvedValue({});
  });

  it("sends the reader's session along when there is one", async () => {
    mockResolveAccessToken.mockResolvedValueOnce("sid_001");

    await expect(submitContactMessage(input)).resolves.toEqual({ ok: true });
    expect(mockSubmitContactMessage).toHaveBeenCalledWith(
      {
        body: "My date of birth is wrong.",
        replyToEmail: "reader@example.com",
        subject: "Date of birth",
        tenant: { tenantId },
      },
      { headers: { Authorization: "Bearer sid_001" } }
    );
  });

  it("names the reader's address the edge recorded, so a guest spends their own allowance", async () => {
    mockResolveAccessToken.mockResolvedValueOnce("");
    mockHeaders.mockResolvedValueOnce(
      new Headers({ "x-forwarded-for": "203.0.113.7" })
    );

    await submitContactMessage(input);

    expect(mockSubmitContactMessage).toHaveBeenCalledWith(expect.anything(), {
      headers: { "X-Forwarded-For": "203.0.113.7" },
    });
  });

  it("sends a guest's message without a session", async () => {
    mockResolveAccessToken.mockResolvedValueOnce("");

    await expect(submitContactMessage(input)).resolves.toEqual({ ok: true });
    expect(mockSubmitContactMessage).toHaveBeenCalledWith(
      expect.objectContaining({ replyToEmail: "reader@example.com" }),
      { headers: {} }
    );
  });

  it("words a rejected message for the reader", async () => {
    mockResolveAccessToken.mockResolvedValueOnce("");
    mockSubmitContactMessage.mockRejectedValueOnce(
      new ConnectError("slow down", Code.ResourceExhausted)
    );

    await expect(submitContactMessage(input)).resolves.toEqual({
      message:
        "Too many requests in a short time. Please wait a moment and try again.",
      ok: false,
    });
  });

  it("rethrows an error it cannot classify", async () => {
    mockResolveAccessToken.mockResolvedValueOnce("");
    const thrown = new ConnectError("boom", Code.Internal);
    mockSubmitContactMessage.mockRejectedValueOnce(thrown);

    await expect(submitContactMessage(input)).rejects.toBe(thrown);
  });
});
