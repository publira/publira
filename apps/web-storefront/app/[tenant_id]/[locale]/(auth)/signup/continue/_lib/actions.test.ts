import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockClearPendingSignUp,
  mockLoginWithIdToken,
  mockReadConsentPageVersionIds,
  mockReadPendingSignUp,
  mockRedirect,
  mockUpdateTag,
  mockWritePublicSessionCookie,
} = vi.hoisted(() => ({
  mockClearPendingSignUp: vi.fn(),
  mockLoginWithIdToken: vi.fn(),
  mockReadConsentPageVersionIds: vi.fn(),
  mockReadPendingSignUp: vi.fn(),
  mockRedirect: vi.fn((location: string) => {
    throw new Error(`redirect to ${location}`);
  }),
  mockUpdateTag: vi.fn(),
  mockWritePublicSessionCookie: vi.fn(),
}));

vi.mock("next/cache", () => ({ updateTag: mockUpdateTag }));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

vi.mock("#lib/auth", () => ({ loginWithIdToken: mockLoginWithIdToken }));

vi.mock("#lib/auth-session", () => ({
  writePublicSessionCookie: mockWritePublicSessionCookie,
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: vi.fn() }));

vi.mock("#lib/social-sign-in", () => ({
  clearPendingSignUp: mockClearPendingSignUp,
  readPendingSignUp: mockReadPendingSignUp,
}));

vi.mock("#lib/tenant", () => ({
  readConsentPageVersionIds: mockReadConsentPageVersionIds,
}));

vi.mock("#lib/tenant-locale-path", () => ({
  tenantLocalePath: (_tenantId: string, locale: string, href: string) =>
    Promise.resolve(`/${locale}${href}`),
}));

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const termsVersionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const pending = {
  authorizationCode: "",
  idToken: "header.payload.signature",
  locale: "en",
  name: "",
  nonce: "nonce-value",
  provider: "google",
  redirectUri: "https://reader.example/api/v1/auth/google/callback",
  returnTo: "/series",
  tenantId,
};

/** The Action forwards the session to the cookie writer without reading it. */
const session = { accessToken: "access-token" };

const form = (fields: Record<string, string> = {}): FormData => {
  const data = new FormData();
  for (const [name, value] of Object.entries({
    agreedPageVersionIds: termsVersionId,
    birthDate: "",
    consent: "on",
    locale: "en",
    tenantId,
    ...fields,
  })) {
    data.set(name, value);
  }
  return data;
};

const submit = async (data: FormData) => {
  const { continueSignUpAction } = await import("./actions");
  return continueSignUpAction(null, data);
};

describe("continueSignUpAction", () => {
  beforeEach(() => {
    mockReadPendingSignUp.mockResolvedValue(pending);
    mockReadConsentPageVersionIds.mockResolvedValue([termsVersionId]);
  });

  it("sends the held token again with the versions the reader agreed to", async () => {
    mockLoginWithIdToken.mockResolvedValueOnce({ kind: "signed_in", session });

    await expect(submit(form({ birthDate: "2000-01-02" }))).rejects.toThrow(
      "redirect to /en/series"
    );

    expect(mockLoginWithIdToken).toHaveBeenCalledWith(tenantId, pending, {
      agreedPageVersionIds: [termsVersionId],
      birthDate: "2000-01-02",
      name: "",
    });
    expect(mockClearPendingSignUp).toHaveBeenCalledOnce();
    expect(mockWritePublicSessionCookie).toHaveBeenCalledWith(
      session,
      tenantId
    );
  });

  it("asks again without spending the token when the box is not ticked", async () => {
    // An unticked checkbox submits nothing at all.
    const data = form();
    data.delete("consent");

    const state = await submit(data);

    expect(state).toEqual({
      message: "Agree to the listed pages to create an account.",
      ok: false,
    });
    expect(mockLoginWithIdToken).not.toHaveBeenCalled();
  });

  it("continues without a checkbox once the tenant stops asking for consent", async () => {
    mockReadConsentPageVersionIds.mockResolvedValueOnce([]);
    mockLoginWithIdToken.mockResolvedValueOnce({ kind: "signed_in", session });
    const data = form();
    data.delete("agreedPageVersionIds");
    data.delete("consent");

    await expect(submit(data)).rejects.toThrow("redirect to /en/series");

    expect(mockLoginWithIdToken).toHaveBeenCalledWith(
      tenantId,
      pending,
      expect.objectContaining({ agreedPageVersionIds: [] })
    );
  });

  it("refuses a version sent twice in place of two pages", async () => {
    const privacyVersionId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    mockReadConsentPageVersionIds.mockResolvedValueOnce([
      termsVersionId,
      privacyVersionId,
    ]);
    const data = form();
    data.append("agreedPageVersionIds", termsVersionId);

    const state = await submit(data);

    expect(state).toEqual({
      message:
        "The pages to agree to have been updated. Read them and agree again.",
      ok: false,
    });
    expect(mockLoginWithIdToken).not.toHaveBeenCalled();
  });

  it("starts over when the held sign-in is gone", async () => {
    mockReadPendingSignUp.mockResolvedValueOnce(null);

    await expect(submit(form())).rejects.toThrow("redirect to /en/login?");

    expect(mockLoginWithIdToken).not.toHaveBeenCalled();
  });

  it("keeps the held sign-in for a birth date the API refused", async () => {
    mockLoginWithIdToken.mockResolvedValueOnce({
      error: new ConnectError("birth date", Code.InvalidArgument),
      kind: "refused",
    });

    const state = await submit(form({ birthDate: "2000-01-02" }));

    expect(state?.ok).toBe(false);
    expect(mockClearPendingSignUp).not.toHaveBeenCalled();
  });

  it("drops the cached pages when the reader agreed to superseded ones", async () => {
    mockReadConsentPageVersionIds.mockResolvedValueOnce([
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    ]);

    const state = await submit(form());

    expect(state?.ok).toBe(false);
    expect(mockUpdateTag).toHaveBeenCalledOnce();
    expect(mockLoginWithIdToken).not.toHaveBeenCalled();
  });
});
