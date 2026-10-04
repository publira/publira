import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetAccessToken,
  mockGetAdminCurrentUser,
  mockHeaders,
  mockRedirect,
} = vi.hoisted(() => ({
  mockGetAccessToken: vi.fn(),
  mockGetAdminCurrentUser: vi.fn(),
  mockHeaders: vi.fn(),
  mockRedirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

vi.mock("next/cache", () => ({
  updateTag: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
  headers: mockHeaders,
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./admin-auth", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAdminCurrentUser: mockGetAdminCurrentUser,
}));

const setReturnTo = (value?: string) => {
  mockHeaders.mockResolvedValue(
    new Headers(value === undefined ? {} : { "x-publira-return-to": value })
  );
};

const importAuthSession = () => import("./auth-session");

describe("web-admin auth-session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    setReturnTo("/series?token=abc");
  });

  it("redirectToLogin sends to /login with the path the proxy recorded and the reason the session expired", async () => {
    const { redirectToLogin } = await importAuthSession();

    await expect(redirectToLogin()).rejects.toThrow(/NEXT_REDIRECT/u);
    expect(mockRedirect).toHaveBeenCalledWith(
      "/login?next=%2Fseries%3Ftoken%3Dabc&reason=session_revoked"
    );
  });

  it("redirectToLogin never takes an external URL as the destination to return to", async () => {
    setReturnTo("https://evil.example.com");
    const { redirectToLogin } = await importAuthSession();

    await expect(redirectToLogin()).rejects.toThrow(/NEXT_REDIRECT/u);
    expect(mockRedirect).toHaveBeenCalledWith(
      "/login?next=%2F&reason=session_revoked"
    );
  });

  it("redirectToLogin returns to the console root when the header is missing", async () => {
    setReturnTo();
    const { redirectToLogin } = await importAuthSession();

    await expect(redirectToLogin()).rejects.toThrow(/NEXT_REDIRECT/u);
    expect(mockRedirect).toHaveBeenCalledWith(
      "/login?next=%2F&reason=session_revoked"
    );
  });

  it("redirectToLoginIfSessionRejected sends only an expired read to a fresh login", async () => {
    const { redirectToLoginIfSessionRejected } = await importAuthSession();

    // Any one of the reads a screen awaits is enough to end the session.
    await expect(
      redirectToLoginIfSessionRejected(
        { ok: true },
        { ok: false, requiresSignIn: true }
      )
    ).rejects.toThrow(/NEXT_REDIRECT/u);

    mockRedirect.mockClear();
    await redirectToLoginIfSessionRejected(
      { ok: false, requiresSignIn: false },
      { ok: true }
    );
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("verifyAdminSession answers the operator the API accepts", async () => {
    const user = { name: "Jane Doe", publicId: "user-001", role: "admin" };
    mockGetAdminCurrentUser.mockResolvedValueOnce({ ok: true, user });
    const { verifyAdminSession } = await importAuthSession();

    await expect(verifyAdminSession("tenant_001")).resolves.toEqual(user);
    expect(mockGetAdminCurrentUser).toHaveBeenCalledWith("tenant_001");
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("verifyAdminSession sends a rejected session to a fresh login", async () => {
    mockGetAdminCurrentUser.mockResolvedValueOnce({
      ok: false,
      requiresSignIn: true,
    });
    const { verifyAdminSession } = await importAuthSession();

    await expect(verifyAdminSession("tenant_001")).rejects.toThrow(
      /NEXT_REDIRECT/u
    );
    expect(mockRedirect).toHaveBeenCalledWith(
      "/login?next=%2Fseries%3Ftoken%3Dabc&reason=session_revoked"
    );
  });

  it("verifyAdminSession sends a session that names nobody to /login", async () => {
    // The shared reads behind the page would answer anyone, so a session this
    // tenant does not know must not reach them either.
    mockGetAdminCurrentUser.mockResolvedValueOnce({
      ok: false,
      requiresSignIn: false,
    });
    const { verifyAdminSession } = await importAuthSession();

    await expect(verifyAdminSession("tenant_001")).rejects.toThrow(
      /NEXT_REDIRECT/u
    );
    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });

  it("requireAdminSession returns the token when there is one", async () => {
    mockGetAccessToken.mockResolvedValueOnce("session-token");
    const { requireAdminSession } = await importAuthSession();

    await expect(requireAdminSession()).resolves.toBe("session-token");
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("requireAdminSession sends to a fresh login when there is no token", async () => {
    mockGetAccessToken.mockResolvedValueOnce("");
    const { requireAdminSession } = await importAuthSession();

    await expect(requireAdminSession()).rejects.toThrow(/NEXT_REDIRECT/u);
    expect(mockRedirect).toHaveBeenCalledWith(
      "/login?next=%2Fseries%3Ftoken%3Dabc&reason=session_revoked"
    );
  });

  it("withAdminSessionReauth returns the successful value untouched", async () => {
    mockGetAccessToken.mockResolvedValue("session-token");
    const { withAdminSessionReauth } = await importAuthSession();

    await expect(
      withAdminSessionReauth(() => Promise.resolve("ok"))
    ).resolves.toBe("ok");
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("withAdminSessionReauth sends to a fresh login only on Unauthenticated", async () => {
    mockGetAccessToken.mockResolvedValue("session-token");
    const { withAdminSessionReauth } = await importAuthSession();

    await expect(
      withAdminSessionReauth(() =>
        Promise.reject(new ConnectError("invalid token", Code.Unauthenticated))
      )
    ).rejects.toThrow(/NEXT_REDIRECT/u);
    expect(mockRedirect).toHaveBeenCalledWith(
      "/login?next=%2Fseries%3Ftoken%3Dabc&reason=session_revoked"
    );
  });

  it("withAdminSessionReauth does not treat a business error as a reauthentication", async () => {
    mockGetAccessToken.mockResolvedValue("session-token");
    const { withAdminSessionReauth } = await importAuthSession();

    // A wrong current password reaches the client as invalid_argument;
    // turning it into a re-login would log the operator out over a typo.
    await expect(
      withAdminSessionReauth(() =>
        Promise.reject(
          new ConnectError("invalid current password", Code.InvalidArgument)
        )
      )
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("withAdminSessionReauth propagates a failure that is not an RPC error", async () => {
    mockGetAccessToken.mockResolvedValue("session-token");
    const { withAdminSessionReauth } = await importAuthSession();

    await expect(
      withAdminSessionReauth(() => Promise.reject(new Error("boom")))
    ).rejects.toThrow("boom");
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("withAdminSessionReauth sends to a fresh login without calling the RPC when the cookie is missing", async () => {
    // A missing cookie never reaches the API, so the mutation would answer with
    // the form error this flow replaces instead of throwing Unauthenticated.
    mockGetAccessToken.mockResolvedValue("");
    const run = vi.fn();
    const { withAdminSessionReauth } = await importAuthSession();

    await expect(withAdminSessionReauth(run)).rejects.toThrow(/NEXT_REDIRECT/u);
    expect(run).not.toHaveBeenCalled();
    expect(mockRedirect).toHaveBeenCalledWith(
      "/login?next=%2Fseries%3Ftoken%3Dabc&reason=session_revoked"
    );
  });
});

const signedInAs = (role: string) => {
  mockGetAdminCurrentUser.mockResolvedValue({
    ok: true,
    user: { name: "Operator", publicId: "USER001", role },
  });
};

describe("signed-in role checks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    setReturnTo("/series");
  });

  it.each([
    ["tenant_admin", true, true],
    ["tenant_editor", false, true],
    ["tenant_auditor", false, false],
  ])("answers a %s as admin %s and editor %s", async (role, admin, editor) => {
    signedInAs(role);
    const { isSignedInTenantAdmin, isSignedInTenantEditor } =
      await importAuthSession();

    await expect(isSignedInTenantAdmin("TENANT001")).resolves.toBe(admin);
    await expect(isSignedInTenantEditor("TENANT001")).resolves.toBe(editor);
    expect(mockGetAdminCurrentUser).toHaveBeenCalledWith("TENANT001");
  });

  it("admits no role when the operator could not be read", async () => {
    mockGetAdminCurrentUser.mockResolvedValue({
      ok: false,
      requiresSignIn: false,
    });
    const { isSignedInTenantAdmin, isSignedInTenantEditor } =
      await importAuthSession();

    await expect(isSignedInTenantAdmin("TENANT001")).resolves.toBe(false);
    await expect(isSignedInTenantEditor("TENANT001")).resolves.toBe(false);
  });

  it("sends a rejected session to /login", async () => {
    mockGetAdminCurrentUser.mockResolvedValue({
      ok: false,
      requiresSignIn: true,
    });
    const { isSignedInTenantEditor } = await importAuthSession();

    await expect(isSignedInTenantEditor("TENANT001")).rejects.toThrow(
      /NEXT_REDIRECT/u
    );
  });
});
