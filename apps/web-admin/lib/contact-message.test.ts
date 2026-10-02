import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssignContactMessage,
  mockGetAccessToken,
  mockGetContactMessage,
  mockListContactMessages,
  mockListTenantMembers,
  mockMarkContactMessageHandled,
} = vi.hoisted(() => ({
  mockAssignContactMessage: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetContactMessage: vi.fn(),
  mockListContactMessages: vi.fn(),
  mockListTenantMembers: vi.fn(),
  mockMarkContactMessageHandled: vi.fn(),
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./api", () => ({
  apiClient: {
    contact: {
      assignContactMessage: mockAssignContactMessage,
      getContactMessage: mockGetContactMessage,
      listContactMessages: mockListContactMessages,
      markContactMessageHandled: mockMarkContactMessageHandled,
    },
    members: {
      listTenantMembers: mockListTenantMembers,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

const adminContactMessage = {
  assigneeName: "",
  assigneePublicId: "",
  assigneeUserId: "",
  body: "The second episode will not open for me.",
  createdAt: "2026-06-01T00:00:00Z",
  handledAt: "",
  id: "018f0f80-0003-7000-8000-000000000001",
  publicId: "CONTACT0001",
  replyToEmail: "reader@example.com",
  senderName: "Reader One",
  senderPublicId: "READER00001",
  status: "unhandled",
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
          id: "018f0f80-0003-7000-8000-000000000002",
          publicId: "CONTACT0002",
          replyToEmail: "guest@example.com",
        },
      ],
    });

    const { listContactMessages } = await import("./contact-message");
    const result = await listContactMessages("TENANT001", "en");

    expect(result.messages[0]).toEqual({
      assigneeName: "",
      assigneePublicId: "",
      assigneeUserId: "",
      body: "Is there an app?",
      createdAt: "2026-06-02T00:00:00Z",
      handledAt: "",
      id: "018f0f80-0003-7000-8000-000000000002",
      publicId: "CONTACT0002",
      replyToEmail: "guest@example.com",
      senderName: "",
      senderPublicId: "",
      status: "unhandled",
      subject: "",
    });
  });

  it("reads the assignee apart from the state the API derived", async () => {
    mockListContactMessages.mockResolvedValue({
      messages: [
        {
          ...adminContactMessage,
          assigneeName: "Staff Two",
          assigneePublicId: "STAFF000002",
          assigneeUserId: "018f0f80-0001-7000-8000-000000000002",
          handledAt: "2026-06-03T00:00:00Z",
          status: "handled",
        },
      ],
    });

    const { listContactMessages } = await import("./contact-message");
    const {
      messages: [message],
    } = await listContactMessages("TENANT001", "en");

    expect(message).toMatchObject({
      assigneeName: "Staff Two",
      assigneePublicId: "STAFF000002",
      assigneeUserId: "018f0f80-0001-7000-8000-000000000002",
      status: "handled",
    });
  });

  it.each([
    { assigneeUserId: "", handledAt: "", status: "unhandled" },
    {
      assigneeUserId: "018f0f80-0001-7000-8000-000000000002",
      handledAt: "",
      status: "in_progress",
    },
    {
      assigneeUserId: "018f0f80-0001-7000-8000-000000000002",
      handledAt: "2026-06-03T00:00:00Z",
      status: "handled",
    },
  ])(
    "derives $status the way the API does when it names no state",
    async ({ assigneeUserId, handledAt, status }) => {
      mockListContactMessages.mockResolvedValue({
        messages: [
          { ...adminContactMessage, assigneeUserId, handledAt, status: "" },
        ],
      });

      const { listContactMessages } = await import("./contact-message");
      const {
        messages: [message],
      } = await listContactMessages("TENANT001", "en");

      expect(message?.status).toBe(status);
    }
  );

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
      {
        contactMessageId: "018f0f80-0003-7000-8000-000000000001",
        handled,
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(mockMarkContactMessageHandled).toHaveBeenCalledWith(
      {
        contactMessageId: "018f0f80-0003-7000-8000-000000000001",
        handled,
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
      {
        contactMessageId: "018f0f80-0003-7000-8000-000000000001",
        handled: true,
        tenantId: "TENANT001",
      },
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
        {
          contactMessageId: "018f0f80-0003-7000-8000-000000000001",
          handled: true,
          tenantId: "TENANT001",
        },
        "en"
      )
    ).rejects.toThrow();
  });

  it("does not call the API when there is no session", async () => {
    mockGetAccessToken.mockResolvedValue("");

    const { markContactMessageHandled } = await import("./contact-message");
    const result = await markContactMessageHandled(
      {
        contactMessageId: "018f0f80-0003-7000-8000-000000000001",
        handled: true,
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(mockMarkContactMessageHandled).not.toHaveBeenCalled();
    expect(result).toEqual({ message: expect.stringMatching(/./u), ok: false });
  });

  it.each(["018f0f80-0001-7000-8000-000000000002", ""])(
    "states the assignee %j",
    async (assigneeUserId) => {
      mockAssignContactMessage.mockResolvedValue({});

      const { assignContactMessage } = await import("./contact-message");
      const result = await assignContactMessage(
        {
          assigneeUserId,
          contactMessageId: "018f0f80-0003-7000-8000-000000000001",
          tenantId: "TENANT001",
        },
        "en"
      );

      expect(mockAssignContactMessage).toHaveBeenCalledWith(
        {
          assigneeUserId,
          contactMessageId: "018f0f80-0003-7000-8000-000000000001",
          tenant: { tenantId: "TENANT001" },
        },
        { headers: { Authorization: "Bearer session-token" } }
      );
      expect(result).toEqual({ ok: true });
    }
  );

  it("reports a refused assignment as a message", async () => {
    mockAssignContactMessage.mockRejectedValue(
      new ConnectError("not assignable", Code.InvalidArgument)
    );

    const { assignContactMessage } = await import("./contact-message");
    const result = await assignContactMessage(
      {
        assigneeUserId: "018f0f80-0001-7000-8000-000000000009",
        contactMessageId: "018f0f80-0003-7000-8000-000000000001",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toEqual({ message: expect.stringMatching(/./u), ok: false });
  });

  it("rethrows a session the assignment was refused for", async () => {
    mockAssignContactMessage.mockRejectedValue(
      new ConnectError("no session", Code.Unauthenticated)
    );

    const { assignContactMessage } = await import("./contact-message");

    await expect(
      assignContactMessage(
        {
          assigneeUserId: "",
          contactMessageId: "018f0f80-0003-7000-8000-000000000001",
          tenantId: "TENANT001",
        },
        "en"
      )
    ).rejects.toThrow();
  });

  it("offers every active tenant admin across every page of members, and nobody else", async () => {
    mockListTenantMembers
      .mockResolvedValueOnce({
        members: [
          {
            email: "one@example.com",
            name: "Staff One",
            role: "tenant_admin",
            status: "active",
            userId: "018f0f80-0001-7000-8000-000000000001",
            userPublicId: "STAFF000001",
          },
          {
            email: "editor@example.com",
            name: "Editor",
            role: "tenant_editor",
            status: "active",
            userId: "018f0f80-0001-7000-8000-000000000003",
            userPublicId: "STAFF000003",
          },
          {
            email: "suspended@example.com",
            name: "Suspended",
            role: "tenant_admin",
            status: "suspended",
            userId: "018f0f80-0001-7000-8000-000000000004",
            userPublicId: "STAFF000004",
          },
        ],
        nextToken: "page-2",
      })
      .mockResolvedValueOnce({
        members: [
          {
            email: "two@example.com",
            name: "",
            role: "tenant_admin",
            status: "active",
            userId: "018f0f80-0001-7000-8000-000000000002",
            userPublicId: "STAFF000002",
          },
        ],
      });

    const { listContactMessageAssignees } = await import("./contact-message");
    const result = await listContactMessageAssignees("TENANT001", "en");

    expect(mockListTenantMembers).toHaveBeenLastCalledWith(
      { limit: 100, tenant: { tenantId: "TENANT001" }, token: "page-2" },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({
      assignees: [
        {
          name: "Staff One",
          userId: "018f0f80-0001-7000-8000-000000000001",
          userPublicId: "STAFF000001",
        },
        {
          name: "two@example.com",
          userId: "018f0f80-0001-7000-8000-000000000002",
          userPublicId: "STAFF000002",
        },
      ],
      ok: true,
    });
  });

  it("fails rather than offering the part of the staff it read", async () => {
    mockListTenantMembers
      .mockResolvedValueOnce({
        members: [
          {
            name: "Staff One",
            role: "tenant_admin",
            status: "active",
            userId: "018f0f80-0001-7000-8000-000000000001",
            userPublicId: "STAFF000001",
          },
        ],
        nextToken: "page-2",
      })
      .mockRejectedValueOnce(new ConnectError("unavailable", Code.Unavailable));

    const { listContactMessageAssignees } = await import("./contact-message");
    const result = await listContactMessageAssignees("TENANT001", "en");

    expect(result).toEqual({
      assignees: [],
      message: expect.stringMatching(/./u),
      ok: false,
      requiresSignIn: false,
    });
  });

  it("asks for sign-in without listing the staff when there is no session", async () => {
    mockGetAccessToken.mockResolvedValue("");

    const { listContactMessageAssignees } = await import("./contact-message");
    const result = await listContactMessageAssignees("TENANT001", "en");

    expect(mockListTenantMembers).not.toHaveBeenCalled();
    expect(result.ok === false && result.requiresSignIn).toBe(true);
  });
});
