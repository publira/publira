import {
  BadRequestSchema,
  Code,
  ConnectError,
} from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCacheLife,
  mockCacheTag,
  mockGetAccessToken,
  mockGetTenantTaxSettingsApi,
  mockUpdateTenantTaxSettingsApi,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetTenantTaxSettingsApi: vi.fn(),
  mockUpdateTenantTaxSettingsApi: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheLife: mockCacheLife,
  cacheTag: mockCacheTag,
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./api", () => ({
  apiClient: {
    tenantSettings: {
      getTenantTaxSettings: mockGetTenantTaxSettingsApi,
      updateTenantTaxSettings: mockUpdateTenantTaxSettingsApi,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

const DROPPED = { expire: 0, revalidate: 0, stale: 0 };

const SAVED = {
  invoiceLegalName: "Example Publishing Inc.",
  invoiceRegistrationNumber: "T1234567890123",
  taxRate: { appliesFrom: "2026-11-01T00:00:00Z", rateBps: 1000 },
  withholdingRateBps: 1021,
};

describe("tenant-tax-settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("reads the settings under the tenant's tag", async () => {
    mockGetTenantTaxSettingsApi.mockResolvedValueOnce({ settings: SAVED });

    const { getTenantTaxSettings } = await import("./tenant-tax-settings");

    await expect(getTenantTaxSettings(" TENANT001 ", "en")).resolves.toEqual({
      ok: true,
      settings: {
        invoiceLegalName: "Example Publishing Inc.",
        invoiceRegistrationNumber: "T1234567890123",
        taxRateAppliesFrom: "2026-11-01T00:00:00Z",
        taxRateBps: 1000,
        withholdingRateBps: 1021,
      },
    });
    expect(mockGetTenantTaxSettingsApi).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockCacheTag).toHaveBeenCalledWith("tenant:TENANT001:tax-settings");
    expect(mockCacheLife).not.toHaveBeenCalled();
  });

  it("answers a tenant that never set a rate, and one whose latest change was to none, as having no rate", async () => {
    mockGetTenantTaxSettingsApi.mockResolvedValueOnce({ settings: {} });
    mockGetTenantTaxSettingsApi.mockResolvedValueOnce({
      settings: { taxRate: { appliesFrom: "2026-11-01T00:00:00Z" } },
    });

    const { getTenantTaxSettings } = await import("./tenant-tax-settings");

    await expect(getTenantTaxSettings("TENANT001", "en")).resolves.toEqual({
      ok: true,
      settings: {
        invoiceLegalName: "",
        invoiceRegistrationNumber: "",
        taxRateAppliesFrom: "",
        taxRateBps: null,
        withholdingRateBps: null,
      },
    });
    await expect(
      getTenantTaxSettings("TENANT001", "en")
    ).resolves.toMatchObject({ settings: { taxRateBps: null } });
  });

  it("reports a missing session and drops the cache entry", async () => {
    mockGetAccessToken.mockResolvedValue("");

    const { getTenantTaxSettings } = await import("./tenant-tax-settings");

    await expect(getTenantTaxSettings("TENANT001", "en")).resolves.toEqual({
      message: "Your session is no longer valid. Please sign in again.",
      ok: false,
      requiresSignIn: true,
    });
    expect(mockGetTenantTaxSettingsApi).not.toHaveBeenCalled();
    expect(mockCacheLife).toHaveBeenCalledWith(DROPPED);
  });

  it("reports the previous release's server, which has no such RPC, as a failed read rather than throwing", async () => {
    mockGetTenantTaxSettingsApi.mockRejectedValueOnce(
      new ConnectError("not implemented", Code.Unimplemented)
    );

    const { getTenantTaxSettings } = await import("./tenant-tax-settings");

    await expect(getTenantTaxSettings("TENANT001", "en")).resolves.toEqual({
      message:
        "Could not load the tax and invoice settings. Please try again later.",
      ok: false,
    });
    expect(mockCacheLife).toHaveBeenCalledWith(DROPPED);
  });

  it("throws an error it cannot classify only outside the cache scope", async () => {
    mockGetTenantTaxSettingsApi.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    const { getTenantTaxSettings } = await import("./tenant-tax-settings");

    await expect(getTenantTaxSettings("TENANT001", "en")).rejects.toThrow(
      Error
    );
    expect(mockCacheLife).toHaveBeenCalledWith(DROPPED);
  });

  it("writes every field, sending no rate for one that is not set", async () => {
    mockUpdateTenantTaxSettingsApi.mockResolvedValueOnce({
      settings: { invoiceLegalName: "Example Publishing Inc." },
    });

    const { updateTenantTaxSettings } = await import("./tenant-tax-settings");

    await expect(
      updateTenantTaxSettings(
        {
          invoiceLegalName: "Example Publishing Inc.",
          invoiceRegistrationNumber: "",
          taxRateBps: null,
          tenantId: " TENANT001 ",
          withholdingRateBps: 1021,
        },
        "en"
      )
    ).resolves.toMatchObject({
      ok: true,
      settings: { invoiceLegalName: "Example Publishing Inc." },
    });
    expect(mockUpdateTenantTaxSettingsApi).toHaveBeenCalledWith(
      {
        invoiceLegalName: "Example Publishing Inc.",
        invoiceRegistrationNumber: "",
        taxRateBps: undefined,
        tenant: { tenantId: "TENANT001" },
        withholdingRateBps: 1021,
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it.each([
    ["taxRateBps", "tax_rate_bps"],
    ["withholdingRateBps", "withholding_rate_bps"],
    ["invoiceLegalName", "invoice_legal_name"],
    ["invoiceRegistrationNumber", "invoice_registration_number"],
  ])(
    "words the server's refusal of %s for its field",
    async (field, violation) => {
      mockUpdateTenantTaxSettingsApi.mockRejectedValueOnce(
        new ConnectError("rejected", Code.InvalidArgument, undefined, [
          {
            desc: BadRequestSchema,
            value: { fieldViolations: [{ field: violation }] },
          },
        ])
      );

      const { updateTenantTaxSettings } = await import("./tenant-tax-settings");

      const message = "This value was not accepted. Check it and save again.";

      await expect(
        updateTenantTaxSettings(
          {
            invoiceLegalName: "",
            invoiceRegistrationNumber: "",
            taxRateBps: 1000,
            tenantId: "T",
            withholdingRateBps: null,
          },
          "en"
        )
      ).resolves.toEqual({
        fieldErrors: { [field]: message },
        message,
        ok: false,
      });
    }
  );

  it("leaves an ended session to the caller's sign-in redirect", async () => {
    mockUpdateTenantTaxSettingsApi.mockRejectedValueOnce(
      new ConnectError("expired", Code.Unauthenticated)
    );

    const { updateTenantTaxSettings } = await import("./tenant-tax-settings");

    await expect(
      updateTenantTaxSettings(
        {
          invoiceLegalName: "",
          invoiceRegistrationNumber: "",
          taxRateBps: null,
          tenantId: "T",
          withholdingRateBps: null,
        },
        "en"
      )
    ).rejects.toBeInstanceOf(ConnectError);
  });
});
