import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockDeleteReader,
  mockGetAccessToken,
  mockGetReader,
  mockListReaders,
  mockSuspendReader,
  mockUnsuspendReader,
} = vi.hoisted(() => ({
  mockDeleteReader: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetReader: vi.fn(),
  mockListReaders: vi.fn(),
  mockSuspendReader: vi.fn(),
  mockUnsuspendReader: vi.fn(),
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./api", () => ({
  apiClient: {
    users: {
      deleteReader: mockDeleteReader,
      getReader: mockGetReader,
      listReaders: mockListReaders,
      suspendReader: mockSuspendReader,
      unsuspendReader: mockUnsuspendReader,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

const adminReader = {
  createdAt: "2026-06-01T00:00:00Z",
  email: "reader@example.com",
  emailVerifiedAt: "2026-06-01T00:05:00Z",
  hasBirthDate: false,
  name: "Reader One",
  publicId: "READER00001",
  status: "suspended",
};

describe("reader lib", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("passes the search, the state, and the cursor through and maps one page", async () => {
    mockListReaders.mockResolvedValue({
      nextToken: "next-token",
      previousToken: "previous-token",
      readers: [adminReader],
    });

    const { listReaders } = await import("./reader");
    const result = await listReaders("TENANT001", "en", {
      limit: 20,
      query: " reader@example.com ",
      status: "suspended",
      token: "current-token",
    });

    expect(mockListReaders).toHaveBeenCalledWith(
      {
        limit: 20,
        query: "reader@example.com",
        status: "suspended",
        tenant: { tenantId: "TENANT001" },
        token: "current-token",
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({
      nextToken: "next-token",
      ok: true,
      previousToken: "previous-token",
      readers: [
        {
          createdAt: "2026-06-01T00:00:00Z",
          email: "reader@example.com",
          name: "Reader One",
          publicId: "READER00001",
          status: "suspended",
        },
      ],
    });
  });

  it("reads a tenant with no readers as an empty page rather than a failure", async () => {
    mockListReaders.mockResolvedValue({});

    const { listReaders } = await import("./reader");

    expect(await listReaders("TENANT001", "en")).toEqual({
      nextToken: "",
      ok: true,
      previousToken: "",
      readers: [],
    });
  });

  it("never presents an account in a state this build does not know as active", async () => {
    mockListReaders.mockResolvedValue({
      readers: [{ ...adminReader, status: "banned" }],
    });

    const { listReaders } = await import("./reader");
    const result = await listReaders("TENANT001", "en");

    expect(result.readers[0]?.status).toBe("inactive");
  });

  it("asks for sign-in without calling the API when there is no session", async () => {
    mockGetAccessToken.mockResolvedValue("");

    const { listReaders } = await import("./reader");
    const result = await listReaders("TENANT001", "en");

    expect(mockListReaders).not.toHaveBeenCalled();
    expect(result.ok === false && result.requiresSignIn).toBe(true);
  });

  it("reports a rejected session as a value so the page can raise the redirect", async () => {
    mockListReaders.mockRejectedValue(
      new ConnectError("no session", Code.Unauthenticated)
    );

    const { listReaders } = await import("./reader");
    const result = await listReaders("TENANT001", "en");

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.requiresSignIn).toBe(true);
  });

  it("reports a refused list as a message, not as a sign-in", async () => {
    mockListReaders.mockRejectedValue(
      new ConnectError("forbidden", Code.PermissionDenied)
    );

    const { listReaders } = await import("./reader");
    const result = await listReaders("TENANT001", "en");

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.requiresSignIn).toBe(false);
    expect(result.ok === false && result.message).not.toBe("");
    expect(result.readers).toEqual([]);
  });

  it("reads one reader's account with the fields only the detail page shows", async () => {
    mockGetReader.mockResolvedValue({ reader: adminReader });

    const { getReader } = await import("./reader");
    const result = await getReader("TENANT001", "en", "READER00001");

    expect(mockGetReader).toHaveBeenCalledWith(
      { publicId: "READER00001", tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({
      ok: true,
      reader: {
        createdAt: "2026-06-01T00:00:00Z",
        email: "reader@example.com",
        emailVerifiedAt: "2026-06-01T00:05:00Z",
        hasBirthDate: false,
        name: "Reader One",
        publicId: "READER00001",
        status: "suspended",
      },
    });
  });

  it.each([Code.NotFound, Code.PermissionDenied])(
    "reads a reader the API will not show (%s) as not found",
    async (code) => {
      mockGetReader.mockRejectedValue(new ConnectError("missing", code));

      const { getReader } = await import("./reader");

      expect(await getReader("TENANT001", "en", "OTHER000001")).toEqual({
        notFound: true,
        ok: false,
      });
    }
  );

  it("reports a failed read as a message, not as a missing reader", async () => {
    mockGetReader.mockRejectedValue(
      new ConnectError("unavailable", Code.Unavailable)
    );

    const { getReader } = await import("./reader");
    const result = await getReader("TENANT001", "en", "READER00001");

    expect(result).toEqual({
      message: expect.stringMatching(/./u),
      ok: false,
      requiresSignIn: false,
    });
  });

  it("asks for sign-in without reading the reader when there is no session", async () => {
    mockGetAccessToken.mockResolvedValue("");

    const { getReader } = await import("./reader");
    const result = await getReader("TENANT001", "en", "READER00001");

    expect(mockGetReader).not.toHaveBeenCalled();
    expect(result).toEqual({
      message: expect.stringMatching(/./u),
      ok: false,
      requiresSignIn: true,
    });
  });

  it.each([
    ["suspend", mockSuspendReader],
    ["unsuspend", mockUnsuspendReader],
    ["delete", mockDeleteReader],
  ] as const)("calls the RPC that %s names", async (action, rpc) => {
    rpc.mockResolvedValue({});

    const { moderateReader } = await import("./reader");
    const result = await moderateReader(
      { action, publicId: "READER00001", tenantId: "TENANT001" },
      "en"
    );

    expect(rpc).toHaveBeenCalledWith(
      { publicId: "READER00001", tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({ ok: true });
  });

  it("reports a refused action as a message", async () => {
    mockSuspendReader.mockRejectedValue(
      new ConnectError("missing", Code.NotFound)
    );

    const { moderateReader } = await import("./reader");
    const result = await moderateReader(
      { action: "suspend", publicId: "READER00001", tenantId: "TENANT001" },
      "en"
    );

    expect(result).toEqual({ message: expect.stringMatching(/./u), ok: false });
  });

  it("rethrows a rejected session so the Action can send staff to sign in", async () => {
    mockDeleteReader.mockRejectedValue(
      new ConnectError("no session", Code.Unauthenticated)
    );

    const { moderateReader } = await import("./reader");

    await expect(
      moderateReader(
        { action: "delete", publicId: "READER00001", tenantId: "TENANT001" },
        "en"
      )
    ).rejects.toThrow();
  });

  it("does not call the API when there is no session", async () => {
    mockGetAccessToken.mockResolvedValue("");

    const { moderateReader } = await import("./reader");
    const result = await moderateReader(
      { action: "delete", publicId: "READER00001", tenantId: "TENANT001" },
      "en"
    );

    expect(mockDeleteReader).not.toHaveBeenCalled();
    expect(result).toEqual({ message: expect.stringMatching(/./u), ok: false });
  });
});
