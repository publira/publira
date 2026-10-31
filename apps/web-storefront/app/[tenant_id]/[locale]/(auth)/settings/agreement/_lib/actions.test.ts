import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAgreeToLegalPages,
  mockRedirect,
  mockRefresh,
  mockRequirePublicSession,
} = vi.hoisted(() => ({
  mockAgreeToLegalPages: vi.fn(),
  mockRedirect: vi.fn((location: string) => {
    throw new Error(`redirect to ${location}`);
  }),
  mockRefresh: vi.fn(),
  mockRequirePublicSession: vi.fn(),
}));

vi.mock("next/cache", () => ({ refresh: mockRefresh }));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

vi.mock("#lib/auth-session", () => ({
  requirePublicSession: mockRequirePublicSession,
  withPublicSessionReauth: (
    _locale: string,
    _returnTo: string,
    run: () => Promise<unknown>
  ) => run(),
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: vi.fn() }));

vi.mock("#lib/legal-page-agreements", () => ({
  agreeToLegalPages: mockAgreeToLegalPages,
}));

vi.mock("#lib/tenant-locale-path", () => ({
  tenantLocalePath: (_tenantId: string, locale: string, href: string) =>
    Promise.resolve(`/${locale}${href}`),
}));

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const termsVersionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const privacyVersionId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const form = (fields: Record<string, string> = {}): FormData => {
  const data = new FormData();

  for (const [name, value] of Object.entries({
    consent: "on",
    locale: "en",
    returnTo: "/series/abc?page=2",
    tenantId,
    ...fields,
  })) {
    data.set(name, value);
  }

  data.append("agreedPageVersionIds", termsVersionId);
  data.append("agreedPageVersionIds", privacyVersionId);

  return data;
};

const submit = async (data: FormData) => {
  const { agreeToLegalPagesAction } = await import("./actions");

  return agreeToLegalPagesAction(null, data);
};

describe("agreeToLegalPagesAction", () => {
  beforeEach(() => {
    mockRequirePublicSession.mockResolvedValue("access-token");
  });

  it("records the versions the screen showed and returns the reader where they were", async () => {
    mockAgreeToLegalPages.mockResolvedValueOnce("agreed");

    await expect(submit(form())).rejects.toThrow(
      "redirect to /en/series/abc?page=2"
    );

    expect(mockAgreeToLegalPages).toHaveBeenCalledWith(
      tenantId,
      "en",
      [termsVersionId, privacyVersionId],
      "access-token"
    );
  });

  it("keeps the return path on the site", async () => {
    mockAgreeToLegalPages.mockResolvedValueOnce("agreed");

    await expect(
      submit(form({ returnTo: "https://evil.example/" }))
    ).rejects.toThrow("redirect to /en/");
  });

  it("never returns the reader to the agreement screen itself", async () => {
    mockAgreeToLegalPages.mockResolvedValueOnce("agreed");

    await expect(
      submit(form({ returnTo: "/settings/agreement?returnTo=%2Fmy" }))
    ).rejects.toThrow("redirect to /en/");
  });

  it("asks again without recording anything when the box is not ticked", async () => {
    // An unticked checkbox submits nothing at all.
    const data = form();
    data.delete("consent");

    const state = await submit(data);

    expect(state).toEqual({
      message: "Agree to the listed pages to continue.",
      ok: false,
    });
    expect(mockAgreeToLegalPages).not.toHaveBeenCalled();
  });

  it("draws the screen again with the pages in force when one changed while it was open", async () => {
    mockAgreeToLegalPages.mockResolvedValueOnce("changed");

    const state = await submit(form());

    expect(state).toEqual({
      message:
        "The pages to agree to have been updated. Read them and agree again.",
      ok: false,
    });
    expect(mockRefresh).toHaveBeenCalledOnce();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("reports a refusal the reader can retry instead of leaving the screen", async () => {
    mockAgreeToLegalPages.mockRejectedValueOnce(
      new ConnectError("slow down", Code.ResourceExhausted)
    );

    const state = await submit(form());

    expect(state).toMatchObject({ ok: false });
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("lets a failure no copy describes reach the error boundary", async () => {
    mockAgreeToLegalPages.mockRejectedValueOnce(new Error("boom"));

    await expect(submit(form())).rejects.toThrow("boom");
  });
});
