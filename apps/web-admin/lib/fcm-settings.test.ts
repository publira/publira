import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCacheTag,
  mockDeleteApi,
  mockGetAccessToken,
  mockGetApi,
  mockSaveApi,
} = vi.hoisted(() => ({
  mockCacheTag: vi.fn(),
  mockDeleteApi: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetApi: vi.fn(),
  mockSaveApi: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheTag: mockCacheTag,
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./api", () => ({
  apiClient: {
    fcmSettings: {
      deleteTenantFcmCredentials: mockDeleteApi,
      getTenantFcmSettings: mockGetApi,
      saveTenantFcmCredentials: mockSaveApi,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

const storedSettings = {
  clientEmail: "push@example-app.iam.gserviceaccount.com",
  configured: true,
  projectId: "example-app",
  updatedAt: "2026-09-21T01:02:03Z",
};

const emptySettings = {
  clientEmail: "",
  configured: false,
  projectId: "",
  updatedAt: "",
};

const leakedKey = "-----BEGIN PRIVATE KEY-----leak-----END PRIVATE KEY-----";

describe("fcm-settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("reads the stored credentials under the tenant's tag", async () => {
    mockGetApi.mockResolvedValueOnce({ settings: storedSettings });
    const { getTenantFcmSettings } = await import("./fcm-settings");

    const result = await getTenantFcmSettings("TENANT001", "en");

    expect(result).toEqual({ ok: true, settings: storedSettings });
    expect(mockGetApi).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockCacheTag).toHaveBeenCalledWith("tenant:TENANT001:fcm-settings");
  });

  it("keeps anything but presence, project, account, and date off the screen", async () => {
    mockGetApi.mockResolvedValueOnce({
      settings: { ...storedSettings, serviceAccountJson: leakedKey },
    });
    const { getTenantFcmSettings } = await import("./fcm-settings");

    const result = await getTenantFcmSettings("TENANT001", "en");

    expect(JSON.stringify(result)).not.toContain(leakedKey);
  });

  it("answers the empty settings while nothing is stored", async () => {
    mockGetApi.mockResolvedValueOnce({
      settings: { ...storedSettings, configured: false },
    });
    const { getTenantFcmSettings } = await import("./fcm-settings");

    const result = await getTenantFcmSettings("TENANT001", "en");

    expect(result).toEqual({ ok: true, settings: emptySettings });
  });

  it("asks for a sign-in without a session", async () => {
    mockGetAccessToken.mockResolvedValue("");
    const { getTenantFcmSettings } = await import("./fcm-settings");

    const result = await getTenantFcmSettings("TENANT001", "en");

    expect(result).toEqual({
      message: "Your session is no longer valid. Please sign in again.",
      ok: false,
      requiresSignIn: true,
    });
    expect(mockGetApi).not.toHaveBeenCalled();
  });

  it("answers a refused key with the console's copy rather than the server's", async () => {
    mockSaveApi.mockRejectedValueOnce(
      new ConnectError(
        "push: invalid service account key: private_key is not a PEM-encoded RSA key",
        Code.InvalidArgument
      )
    );
    const { saveTenantFcmCredentials } = await import("./fcm-settings");

    const result = await saveTenantFcmCredentials(
      {
        projectId: "example-app",
        serviceAccountJson: leakedKey,
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toEqual({
      message:
        "The service account key could not be used. Download a new private key from Project settings → Service accounts in the Firebase console and upload it.",
      ok: false,
    });
  });

  it("explains a server without an encryption key", async () => {
    mockSaveApi.mockRejectedValueOnce(
      new ConnectError(
        "secret encryption is not configured",
        Code.FailedPrecondition
      )
    );
    const { saveTenantFcmCredentials } = await import("./fcm-settings");

    const result = await saveTenantFcmCredentials(
      {
        projectId: "example-app",
        serviceAccountJson: "{}",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.message).toContain(
      "PUBLIRA_SECRET_ENCRYPTION_KEYS"
    );
  });

  it("answers the saved settings and never the key", async () => {
    mockSaveApi.mockResolvedValueOnce({ settings: storedSettings });
    const { saveTenantFcmCredentials } = await import("./fcm-settings");

    const result = await saveTenantFcmCredentials(
      {
        projectId: "example-app",
        serviceAccountJson: leakedKey,
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toEqual({ ok: true, settings: storedSettings });
    expect(mockSaveApi).toHaveBeenCalledWith(
      {
        projectId: "example-app",
        serviceAccountJson: leakedKey,
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("answers the empty settings after a removal", async () => {
    mockDeleteApi.mockResolvedValueOnce({ settings: {} });
    const { deleteTenantFcmCredentials } = await import("./fcm-settings");

    const result = await deleteTenantFcmCredentials("TENANT001", "en");

    expect(result).toEqual({ ok: true, settings: emptySettings });
  });

  it("does not swallow an error it cannot classify", async () => {
    mockDeleteApi.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );
    const { deleteTenantFcmCredentials } = await import("./fcm-settings");

    await expect(deleteTenantFcmCredentials("TENANT001", "en")).rejects.toThrow(
      /boom/u
    );
  });
});
