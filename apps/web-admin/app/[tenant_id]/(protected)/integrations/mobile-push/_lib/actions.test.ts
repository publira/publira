import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockDeleteTenantFcmCredentials,
  mockGetAccessToken,
  mockSaveTenantFcmCredentials,
  mockUpdateTag,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockDeleteTenantFcmCredentials: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockSaveTenantFcmCredentials: vi.fn(),
  mockUpdateTag: vi.fn(),
}));

vi.mock("#lib/action-messages", () => ({
  getActionLocale: () => Promise.resolve("en"),
}));

vi.mock("next/cache", () => ({
  updateTag: mockUpdateTag,
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("#lib/fcm-settings", () => ({
  deleteTenantFcmCredentials: mockDeleteTenantFcmCredentials,
  saveTenantFcmCredentials: mockSaveTenantFcmCredentials,
  tenantFcmSettingsCacheTag: (tenantId: string) =>
    `tenant:${tenantId}:fcm-settings`,
}));

const PRIVATE_KEY =
  "-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----\n";

const serviceAccountKey = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    client_email: "push@example-app.iam.gserviceaccount.com",
    private_key: PRIVATE_KEY,
    project_id: "example-app",
    type: "service_account",
    ...overrides,
  });

const saveFormData = (projectId: string, keyFile?: string): FormData => {
  const formData = new FormData();
  formData.set("tenant_id", "TENANT001");
  formData.set("project_id", projectId);
  if (keyFile !== undefined) {
    formData.set(
      "service_account_file",
      new File([keyFile], "key.json", { type: "application/json" })
    );
  }
  return formData;
};

describe("saveFcmCredentialsAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("sends the uploaded key and clears the settings read", async () => {
    mockSaveTenantFcmCredentials.mockResolvedValueOnce({ ok: true });
    const { saveFcmCredentialsAction } = await import("./actions");

    const result = await saveFcmCredentialsAction(
      null,
      saveFormData(" example-app ", serviceAccountKey())
    );

    expect(result).toEqual({
      message: "The Firebase credentials were saved.",
      ok: true,
    });
    expect(mockSaveTenantFcmCredentials).toHaveBeenCalledWith(
      {
        projectId: "example-app",
        serviceAccountJson: serviceAccountKey(),
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("tenant:TENANT001:fcm-settings");
  });

  it("asks for a file when none was chosen", async () => {
    const { saveFcmCredentialsAction } = await import("./actions");

    const result = await saveFcmCredentialsAction(
      null,
      saveFormData("example-app")
    );

    expect(result).toEqual({
      message: "Select the service account key file.",
      ok: false,
    });
    expect(mockSaveTenantFcmCredentials).not.toHaveBeenCalled();
  });

  it("refuses a file that is not JSON without repeating its contents", async () => {
    const { saveFcmCredentialsAction } = await import("./actions");

    const result = await saveFcmCredentialsAction(
      null,
      saveFormData("example-app", `${PRIVATE_KEY} trailing`)
    );

    expect(result).toEqual({
      message:
        "That file is not JSON. Select the service account key file Firebase downloaded.",
      ok: false,
    });
    expect(mockSaveTenantFcmCredentials).not.toHaveBeenCalled();
  });

  it("refuses JSON that is not a service account key", async () => {
    const { saveFcmCredentialsAction } = await import("./actions");

    const result = await saveFcmCredentialsAction(
      null,
      saveFormData(
        "example-app",
        serviceAccountKey({ type: "authorized_user" })
      )
    );

    expect(result?.ok).toBe(false);
    expect(result?.message).toBe(
      "That file is not a service account key. Download one from Project settings → Service accounts in the Firebase console."
    );
    expect(mockSaveTenantFcmCredentials).not.toHaveBeenCalled();
  });

  it("names both projects when the key belongs to another one", async () => {
    const { saveFcmCredentialsAction } = await import("./actions");

    const result = await saveFcmCredentialsAction(
      null,
      saveFormData(
        "example-app",
        serviceAccountKey({ project_id: "other-app" })
      )
    );

    expect(result).toEqual({
      message:
        'The key belongs to the Firebase project "other-app", not "example-app". Upload a key from the project the mobile app is built with, or correct the project ID.',
      ok: false,
    });
    expect(result?.message).not.toContain(PRIVATE_KEY);
    expect(mockSaveTenantFcmCredentials).not.toHaveBeenCalled();
  });

  it("passes on a refusal from the server and keeps the cache", async () => {
    mockSaveTenantFcmCredentials.mockResolvedValueOnce({
      message: "The service account key could not be used.",
      ok: false,
    });
    const { saveFcmCredentialsAction } = await import("./actions");

    const result = await saveFcmCredentialsAction(
      null,
      saveFormData("example-app", serviceAccountKey())
    );

    expect(result).toEqual({
      message: "The service account key could not be used.",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});

describe("deleteFcmCredentialsAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("removes the credentials and clears the settings read", async () => {
    mockDeleteTenantFcmCredentials.mockResolvedValueOnce({ ok: true });
    const { deleteFcmCredentialsAction } = await import("./actions");
    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");

    const result = await deleteFcmCredentialsAction(null, formData);

    expect(result).toEqual({
      message: "The Firebase credentials were removed.",
      ok: true,
    });
    expect(mockDeleteTenantFcmCredentials).toHaveBeenCalledWith(
      "TENANT001",
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("tenant:TENANT001:fcm-settings");
  });
});
