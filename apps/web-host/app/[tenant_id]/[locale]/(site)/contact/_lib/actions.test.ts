import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAssertSameOrigin, mockRedirect, mockSubmitContactMessage } =
  vi.hoisted(() => ({
    mockAssertSameOrigin: vi.fn(),
    mockRedirect: vi.fn(),
    mockSubmitContactMessage: vi.fn(),
  }));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

vi.mock("#lib/contact", () => ({
  submitContactMessage: mockSubmitContactMessage,
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/tenant", () => ({
  getTenantDefaultLocale: () => "en",
}));

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const formData = (values: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [name, value] of Object.entries({
    body: "My date of birth is wrong.",
    locale: "en",
    replyToEmail: "reader@example.com",
    subject: "",
    tenantId,
    ...values,
  })) {
    data.set(name, value);
  }
  return data;
};

describe("submitContactMessageAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("sends the trimmed message and shows the confirmation", async () => {
    mockSubmitContactMessage.mockResolvedValueOnce({ ok: true });

    const { submitContactMessageAction } = await import("./actions");
    await submitContactMessageAction(
      null,
      formData({ body: "  My date of birth is wrong.  ", subject: " DOB " })
    );

    expect(mockSubmitContactMessage).toHaveBeenCalledWith({
      body: "My date of birth is wrong.",
      locale: "en",
      replyToEmail: "reader@example.com",
      subject: "DOB",
      tenantId,
    });
    expect(mockRedirect).toHaveBeenCalledWith("/contact/sent");
  });

  it("confirms in the locale the form was sent from", async () => {
    mockSubmitContactMessage.mockResolvedValueOnce({ ok: true });

    const { submitContactMessageAction } = await import("./actions");
    await submitContactMessageAction(null, formData({ locale: "ja" }));

    expect(mockRedirect).toHaveBeenCalledWith("/ja/contact/sent");
  });

  it("refuses an empty message without sending it", async () => {
    const { submitContactMessageAction } = await import("./actions");
    const result = await submitContactMessageAction(
      null,
      formData({ body: "   " })
    );

    expect(result).toEqual({ message: "Enter a message.", ok: false });
    expect(mockSubmitContactMessage).not.toHaveBeenCalled();
  });

  it("refuses a message longer than the API accepts, counting code points", async () => {
    mockSubmitContactMessage.mockResolvedValueOnce({ ok: true });
    const { submitContactMessageAction } = await import("./actions");

    // 4000 emoji are 8000 UTF-16 code units and still within the limit.
    await submitContactMessageAction(
      null,
      formData({ body: "😀".repeat(4000) })
    );
    expect(mockSubmitContactMessage).toHaveBeenCalledOnce();

    const result = await submitContactMessageAction(
      null,
      formData({ body: "a".repeat(4001) })
    );
    expect(result).toEqual({
      message: "Keep the message to 4000 characters or fewer.",
      ok: false,
    });
  });

  it("refuses an address that is not one", async () => {
    const { submitContactMessageAction } = await import("./actions");
    const result = await submitContactMessageAction(
      null,
      formData({ replyToEmail: "not-an-address" })
    );

    expect(result?.ok).toBe(false);
    expect(mockSubmitContactMessage).not.toHaveBeenCalled();
  });

  it("returns the API's rejection to the form instead of redirecting", async () => {
    mockSubmitContactMessage.mockResolvedValueOnce({
      message: "Could not send your message. Please try again.",
      ok: false,
    });

    const { submitContactMessageAction } = await import("./actions");
    const result = await submitContactMessageAction(null, formData({}));

    expect(result).toEqual({
      message: "Could not send your message. Please try again.",
      ok: false,
    });
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
