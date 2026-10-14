import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockCreatePlatformTenant,
  mockGetPlatformLocale,
  mockRedirect,
  mockResolveAccessToken,
  mockUpdateTag,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockCreatePlatformTenant: vi.fn(),
  mockGetPlatformLocale: vi.fn(),
  mockRedirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  mockResolveAccessToken: vi.fn(),
  mockUpdateTag: vi.fn(),
}));

vi.mock("next/cache", () => ({ updateTag: mockUpdateTag }));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/api-client", () => ({
  resolveAccessToken: mockResolveAccessToken,
}));

vi.mock("#lib/tenants", () => ({
  createPlatformTenant: mockCreatePlatformTenant,
  platformTenantsCacheTag: "platform:tenants",
}));

vi.mock("#lib/users", () => ({ platformEndUsersCacheTag: "platform:users" }));

vi.mock("#lib/dashboard", () => ({
  platformDashboardCacheTag: "platform:dashboard",
}));

vi.mock("#lib/audit-logs", () => ({
  platformAuditLogsCacheTag: "platform:audit-logs",
}));

vi.mock("#lib/locale", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return { ...actual, getPlatformLocale: mockGetPlatformLocale };
});

/**
 * A form as the create screen submits it, offering the default language alone
 * unless `tenant_supported_locales` names the set.
 */
const tenantFormData = (
  overrides: Record<string, string | readonly string[]> = {}
): FormData => {
  const fields: Record<string, string | readonly string[]> = {
    initial_admin_emails: "",
    tenant_admin_domain: "",
    tenant_default_locale: "en",
    tenant_domain: "tenant-example.example.com",
    tenant_name: "Example Tenant",
    ...overrides,
  };
  const supportedLocales = fields.tenant_supported_locales ?? [
    String(fields.tenant_default_locale),
  ];

  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === "string") {
      formData.set(key, value);
    }
  }
  for (const code of supportedLocales) {
    formData.append("tenant_supported_locales", code);
  }
  return formData;
};

describe("createTenantAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    // `withPlatformSessionReauth` resolves the session before the mutation
    // runs; without a token the Action would redirect to /login instead.
    mockResolveAccessToken.mockResolvedValue("session-token");
    // Deliberately not the locale the success case submits: the new tenant's
    // language comes from the form, not from the console the operator is
    // looking at.
    mockGetPlatformLocale.mockResolvedValue("en");
  });

  it("sends the locale chosen on the form as the new tenant's default", async () => {
    mockCreatePlatformTenant.mockResolvedValueOnce({
      ok: true,
      publicId: "TENANT00001",
    });

    const { createTenantAction } = await import("./actions");

    await expect(
      createTenantAction(null, tenantFormData({ tenant_default_locale: "ja" }))
    ).rejects.toThrow("NEXT_REDIRECT:/tenants/TENANT00001");
    expect(mockCreatePlatformTenant).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultLocale: "ja",
        domain: "tenant-example.example.com",
        name: "Example Tenant",
      })
    );
  });

  it("sends the languages chosen on the form as the ones the site offers", async () => {
    mockCreatePlatformTenant.mockResolvedValueOnce({
      ok: true,
      publicId: "TENANT00001",
    });

    const { createTenantAction } = await import("./actions");

    await expect(
      createTenantAction(
        null,
        tenantFormData({
          tenant_default_locale: "en",
          tenant_supported_locales: ["ja", "en"],
        })
      )
    ).rejects.toThrow("NEXT_REDIRECT:/tenants/TENANT00001");
    expect(mockCreatePlatformTenant).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultLocale: "en",
        supportedLocales: ["ja", "en"],
      })
    );
  });

  // The form always sends the default among the languages offered, so a set
  // without it is a tampered request, refused before it reaches the API.
  it("refuses a set of languages that leaves the default out", async () => {
    const { createTenantAction } = await import("./actions");

    const result = await createTenantAction(
      null,
      tenantFormData({
        tenant_default_locale: "en",
        tenant_supported_locales: ["ja"],
      })
    );

    expect(result).toEqual({
      message: "The default language must be one of the languages offered.",
      ok: false,
    });
    expect(mockCreatePlatformTenant).not.toHaveBeenCalled();
  });

  it("rejects a locale outside the supported list without calling the API", async () => {
    const { createTenantAction } = await import("./actions");

    const result = await createTenantAction(
      null,
      tenantFormData({ tenant_default_locale: "fr" })
    );

    expect(result?.ok).toBe(false);
    expect(mockCreatePlatformTenant).not.toHaveBeenCalled();
  });

  it("rejects a submission that carries no locale at all", async () => {
    const formData = tenantFormData();
    formData.delete("tenant_default_locale");

    const { createTenantAction } = await import("./actions");

    const result = await createTenantAction(null, formData);

    expect(result?.ok).toBe(false);
    expect(mockCreatePlatformTenant).not.toHaveBeenCalled();
  });

  it("reports a creation failure instead of redirecting", async () => {
    mockCreatePlatformTenant.mockResolvedValueOnce({
      message: "Could not create the tenant.",
      ok: false,
    });

    const { createTenantAction } = await import("./actions");

    await expect(createTenantAction(null, tenantFormData())).resolves.toEqual({
      message: "Could not create the tenant.",
      ok: false,
    });
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});

describe("createTenantAction cache tags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockResolveAccessToken.mockResolvedValue("session-token");
    mockGetPlatformLocale.mockResolvedValue("en");
  });

  it("clears every read the new tenant appears in before redirecting", async () => {
    mockCreatePlatformTenant.mockResolvedValueOnce({ ok: true, publicId: "" });

    const { createTenantAction } = await import("./actions");

    await expect(createTenantAction(null, tenantFormData())).rejects.toThrow(
      "NEXT_REDIRECT:/tenants"
    );
    expect(mockUpdateTag.mock.calls.map(([tag]) => tag)).toEqual([
      "platform:tenants",
      "platform:users",
      "platform:dashboard",
      "platform:audit-logs",
    ]);
  });
});
