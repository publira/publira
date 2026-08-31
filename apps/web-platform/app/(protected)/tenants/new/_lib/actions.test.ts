import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockCreatePlatformTenant,
  mockGetPlatformLocale,
  mockRedirect,
  mockResolveAccessToken,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockCreatePlatformTenant: vi.fn(),
  mockGetPlatformLocale: vi.fn(),
  mockRedirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  mockResolveAccessToken: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/api-client", () => ({
  resolveAccessToken: mockResolveAccessToken,
}));

vi.mock("#lib/tenants", () => ({
  createPlatformTenant: mockCreatePlatformTenant,
}));

vi.mock("#lib/locale", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return { ...actual, getPlatformLocale: mockGetPlatformLocale };
});

const tenantFormData = (overrides: Record<string, string> = {}): FormData => {
  const fields = {
    initial_admin_emails: "",
    tenant_admin_domain: "",
    tenant_default_locale: "en",
    tenant_domain: "tenant-example.example.com",
    tenant_name: "Example Tenant",
    ...overrides,
  };

  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
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
    mockGetPlatformLocale.mockResolvedValue("en");
  });

  it("sends the locale chosen on the form as the new tenant's default", async () => {
    mockCreatePlatformTenant.mockResolvedValueOnce({
      ok: true,
      publicId: "TENANT00001",
    });

    const { createTenantAction } = await import("./actions");

    await expect(createTenantAction(null, tenantFormData())).rejects.toThrow(
      "NEXT_REDIRECT:/tenants/TENANT00001"
    );
    expect(mockCreatePlatformTenant).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultLocale: "en",
        domain: "tenant-example.example.com",
        name: "Example Tenant",
      })
    );
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
  });
});
