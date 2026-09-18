import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetAccessToken,
  mockGetContactMessage,
  mockListContactMessages,
  mockMarkContactMessageHandled,
} = vi.hoisted(() => ({
  mockGetAccessToken: vi.fn(),
  mockGetContactMessage: vi.fn(),
  mockListContactMessages: vi.fn(),
  mockMarkContactMessageHandled: vi.fn(),
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./api", () => ({
  apiClient: {
    contact: {
      getContactMessage: mockGetContactMessage,
      listContactMessages: mockListContactMessages,
      markContactMessageHandled: mockMarkContactMessageHandled,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

const adminContactMessage = {
  body: "The second episode will not open for me.",
  createdAt: "2026-06-01T00:00:00Z",
  handledAt: "",
  publicId: "CONTACT0001",
  replyToEmail: "reader@example.com",
  senderName: "Reader One",
  senderPublicId: "READER00001",
  subject: "Cannot open an episode",
};

const contactMessageItem = { ...adminContactMessage };

describe("contact message lib", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("passes the state and the cursor through and maps one page", async () => {
    mockListContactMessages.mockResolvedValue({
      messages: [adminContactMessage],
      nextToken: "next-token",
      previousToken: "previous-token",
    });

    const { listContactMessages } = await import("./contact-message");
    const result = await listContactMessages("TENANT001", "en", {
      limit: 20,
      status: " unhandled ",
      token: "current-token",
    });

    expect(mockListContactMessages).toHaveBeenCalledWith(
      {
        limit: 20,
        status: "unhandled",
        tenant: { tenantId: "TENANT001" },
        token: "current-token",
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({
      messages: [contactMessageItem],
      nextToken: "next-token",
      ok: true,
      previousToken: "previous-token",
    });
  });

  it("reads a tenant nobody has written to as an empty page rather than a failure", async () => {
    mockListContactMessages.mockResolvedValue({});

    const { listContactMessages } = await import("./contact-message");

    expect(await listContactMessages("TENANT001", "en")).toEqual({
      messages: [],
      nextToken: "",
      ok: true,
      previousToken: "",
    });
  });

  it("reads a message with no account behind it as one nobody is named on", async () => {
    mockListContactMessages.mockResolvedValue({
      messages: [
        {
          body: "Is there an app?",
          createdAt: "2026-06-02T00:00:00Z",
          publicId: "CONTACT0002",
          replyToEmail: "guest@example.com",
        },
      ],
    });

    const { listContactMessages } = await import("./contact-message");
    const result = await listContactMessages("TENANT001", "en");

    expect(result.messages[0]).toEqual({
      body: "Is there an app?",
      createdAt: "2026-06-02T00:00:00Z",
      handledAt: "",
      publicId: "CONTACT0002",
      replyToEmail: "guest@example.com",
      senderName: "",
      senderPublicId: "",
      subject: "",
    });
  });

  it("asks for sign-in without calling the API when there is no session", async () => {
    mockGetAccessToken.mockResolvedValue("");

    const { listContactMessages } = await import("./contact-message");
    const result = await listContactMessages("TENANT001", "en");

    expect(mockListContactMessages).not.toHaveBeenCalled();
    expect(result.ok === false && result.requiresSignIn).toBe(true);
  });

  it("reports a rejected session as a value so the page can raise the redirect", async () => {
    mockListContactMessages.mockRejectedValue(
      new ConnectError("no session", Code.Unauthenticated)
    );

    const { listContactMessages } = await import("./contact-message");
    const result = await listContactMessages("TENANT001", "en");

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.requiresSignIn).toBe(true);
  });

  it("reports a refused list as a message, not as a sign-in", async () => {
    mockListContactMessages.mockRejectedValue(
      new ConnectError("forbidden", Code.PermissionDenied)
    );

    const { listContactMessages } = await import("./contact-message");
    const result = await listContactMessages("TENANT001", "en");

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.requiresSignIn).toBe(false);
    expect(result.ok === false && result.message).not.toBe("");
    expect(result.messages).toEqual([]);
  });

  it("reads one message in full", async () => {
    mockGetContactMessage.mockResolvedValue({
      message: { ...adminContactMessage, handledAt: "2026-06-03T00:00:00Z" },
    });

    const { getContactMessage } = await import("./contact-message");
    const result = await getContactMessage("TENANT001", "en", "CONTACT0001");

    expect(mockGetContactMessage).toHaveBeenCalledWith(
      { publicId: "CONTACT0001", tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({
      contactMessage: {
        ...contactMessageItem,
        handledAt: "2026-06-03T00:00:00Z",
      },
      ok: true,
    });
  });

  it.each([Code.NotFound, Code.PermissionDenied])(
    "reads a message the API will not show (%s) as not found",
    async (code) => {
      mockGetContactMessage.mockRejectedValue(
        new ConnectError("missing", code)
      );

      const { getContactMessage } = await import("./contact-message");

      expect(await getContactMessage("TENANT001", "en", "OTHER000001")).toEqual(
        { notFound: true, ok: false }
      );
    }
  );

  it("reports a failed read as a message, not as a missing one", async () => {
    mockGetContactMessage.mockRejectedValue(
      new ConnectError("unavailable", Code.Unavailable)
    );

    const { getContactMessage } = await import("./contact-message");
    const result = await getContactMessage("TENANT001", "en", "CONTACT0001");

    expect(result).toEqual({
      message: expect.stringMatching(/./u),
      ok: false,
      requiresSignIn: false,
    });
  });

  it.each([true, false])("states the handled flag as %s", async (handled) => {
    mockMarkContactMessageHandled.mockResolvedValue({});

    const { markContactMessageHandled } = await import("./contact-message");
    const result = await markContactMessageHandled(
      { handled, publicId: "CONTACT0001", tenantId: "TENANT001" },
      "en"
    );

    expect(mockMarkContactMessageHandled).toHaveBeenCalledWith(
      {
        handled,
        publicId: "CONTACT0001",
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({ ok: true });
  });

  it("reports a refused mark as a message", async () => {
    mockMarkContactMessageHandled.mockRejectedValue(
      new ConnectError("missing", Code.NotFound)
    );

    const { markContactMessageHandled } = await import("./contact-message");
    const result = await markContactMessageHandled(
      { handled: true, publicId: "CONTACT0001", tenantId: "TENANT001" },
      "en"
    );

    expect(result).toEqual({ message: expect.stringMatching(/./u), ok: false });
  });

  it("rethrows a rejected session so the Action can send staff to sign in", async () => {
    mockMarkContactMessageHandled.mockRejectedValue(
      new ConnectError("no session", Code.Unauthenticated)
    );

    const { markContactMessageHandled } = await import("./contact-message");

    await expect(
      markContactMessageHandled(
        { handled: true, publicId: "CONTACT0001", tenantId: "TENANT001" },
        "en"
      )
    ).rejects.toThrow();
  });

  it("does not call the API when there is no session", async () => {
    mockGetAccessToken.mockResolvedValue("");

    const { markContactMessageHandled } = await import("./contact-message");
    const result = await markContactMessageHandled(
      { handled: true, publicId: "CONTACT0001", tenantId: "TENANT001" },
      "en"
    );

    expect(mockMarkContactMessageHandled).not.toHaveBeenCalled();
    expect(result).toEqual({ message: expect.stringMatching(/./u), ok: false });
  });
});
