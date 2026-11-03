import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockGetTenantDefaultLocale,
  mockRedirect,
  mockRequestMyDataExport,
  mockRequirePublicSession,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockGetTenantDefaultLocale: vi.fn(),
  mockRedirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  mockRequestMyDataExport: vi.fn(),
  mockRequirePublicSession: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

vi.mock("#lib/auth-session", () => ({
  requirePublicSession: mockRequirePublicSession,
  withPublicSessionReauth: <Result>(
    _locale: string,
    _returnTo: string,
    run: () => Promise<Result>
  ) => run(),
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/data-export", () => ({
  requestMyDataExport: mockRequestMyDataExport,
}));

vi.mock("#lib/tenant", () => ({
  getTenantDefaultLocale: mockGetTenantDefaultLocale,
}));

const { requestDataExportAction } = await import("./data-export-actions");

const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const form = (fields: Record<string, string> = {}): FormData => {
  const data = new FormData();

  for (const [name, value] of Object.entries({
    locale: "en",
    tenantId: TENANT_ID,
    ...fields,
  })) {
    data.set(name, value);
  }

  return data;
};

/** The settings screen the Action ends on, with the flash it carries. */
const settingsFlash = (
  status: "error" | "success",
  message: string,
  prefix = ""
): string =>
  `NEXT_REDIRECT:${prefix}/settings?${new URLSearchParams({ message, status })}`;

describe("requestDataExportAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTenantDefaultLocale.mockResolvedValue("en");
    mockRequirePublicSession.mockResolvedValue("session-token");
    mockRequestMyDataExport.mockResolvedValue({ ok: true });
  });

  it("asks for the archive and returns to the section, which now shows it being prepared", async () => {
    await expect(requestDataExportAction(form())).rejects.toThrow(
      settingsFlash(
        "success",
        "Your request was received. You are told when your data is ready to download."
      )
    );
    expect(mockAssertSameOrigin).toHaveBeenCalledOnce();
    expect(mockRequestMyDataExport).toHaveBeenCalledWith(
      TENANT_ID,
      "session-token"
    );
  });

  it("words the outcome in the locale the screen is on", async () => {
    await expect(
      requestDataExportAction(form({ locale: "ja" }))
    ).rejects.toThrow(
      settingsFlash(
        "success",
        "リクエストを受け付けました。ダウンロードできるようになったらお知らせします。",
        "/ja"
      )
    );
  });

  it.each([
    [
      "in-progress",
      "A copy of your data is already being prepared. You are told when it is ready.",
    ],
    [
      "storage-not-configured",
      "Copies of your data cannot be prepared on this site right now. Contact the site if this continues.",
    ],
    [
      "precondition",
      "Could not request a copy of your data. Please try again later.",
    ],
  ])("words the %s refusal", async (refusal, message) => {
    mockRequestMyDataExport.mockResolvedValue({ ok: false, refusal });

    await expect(requestDataExportAction(form())).rejects.toThrow(
      settingsFlash("error", message)
    );
  });

  it("words a request past the platform's limit with the shared copy", async () => {
    mockRequestMyDataExport.mockResolvedValue({
      ok: false,
      refusal: "rate-limited",
    });

    await expect(requestDataExportAction(form())).rejects.toThrow(
      /^NEXT_REDIRECT:\/settings\?message=.+&status=error$/u
    );
    expect(mockRedirect).not.toHaveBeenCalledWith(
      expect.stringContaining(
        encodeURIComponent("Could not request a copy").replaceAll("%20", "+")
      )
    );
  });

  it.each([
    ["names no tenant", ""],
    ["names something that is not a tenant ID", "not-a-tenant"],
  ])(
    "returns a form that %s to the section without reading the tenant",
    async (_case, tenantId) => {
      await expect(requestDataExportAction(form({ tenantId }))).rejects.toThrow(
        settingsFlash(
          "error",
          "Could not request a copy of your data. Please try again later.",
          "/en"
        )
      );
      expect(mockGetTenantDefaultLocale).not.toHaveBeenCalled();
      expect(mockRequestMyDataExport).not.toHaveBeenCalled();
    }
  );
});
