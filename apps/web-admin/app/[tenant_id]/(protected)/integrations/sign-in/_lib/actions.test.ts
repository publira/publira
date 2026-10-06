import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAssertSameOrigin, mockUpdateTag, mockUpdateTenantSignInSettings } =
  vi.hoisted(() => ({
    mockAssertSameOrigin: vi.fn(),
    mockUpdateTag: vi.fn(),
    mockUpdateTenantSignInSettings: vi.fn(),
  }));

vi.mock("#lib/action-messages", async () => {
  const { bindMessages } = await import("@publira/i18n");
  const { sharedCatalog } = await import("@publira/i18n/catalog");
  return {
    getActionLocale: () => Promise.resolve("en"),
    getActionMessages: () =>
      Promise.resolve(bindMessages(sharedCatalog("en"), "en")),
  };
});

vi.mock("next/cache", () => ({
  updateTag: mockUpdateTag,
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/auth-session", () => ({
  withAdminSessionReauth: (run: () => Promise<unknown>) => run(),
}));

vi.mock("#lib/tenant-sign-in-settings", () => ({
  tenantSignInSettingsCacheTag: (tenantId: string) =>
    `tenant:${tenantId}:sign-in-settings`,
  updateTenantSignInSettings: mockUpdateTenantSignInSettings,
}));

const APPLE_KEY = `-----BEGIN PRIVATE KEY-----
MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQg
-----END PRIVATE KEY-----`;

const WEB_CLIENT_ID = "123456789012-abc123.apps.googleusercontent.com";
const IOS_CLIENT_ID = "123456789012-def456.apps.googleusercontent.com";

const signInFormData = (
  values: Record<string, string>,
  files: Record<string, File> = {}
): FormData => {
  const formData = new FormData();
  for (const [name, value] of Object.entries({
    apple_private_key_configured: "0",
    apple_private_key_mode: "replace",
    tenant_id: "TENANT001",
    ...values,
  })) {
    formData.set(name, value);
  }
  for (const [name, file] of Object.entries(files)) {
    formData.set(name, file);
  }
  return formData;
};

const VALIDATION = "Please check the information you entered.";

describe("updateTenantSignInSettingsAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("saves both providers with the key from the chosen file, then clears the cache tag", async () => {
    mockUpdateTenantSignInSettings.mockResolvedValueOnce({
      ok: true,
      settings: {},
    });

    const { updateTenantSignInSettingsAction } = await import("./actions");
    const result = await updateTenantSignInSettingsAction(
      null,
      signInFormData(
        {
          apple_enabled: "on",
          apple_key_id: " 2x9r4hxf34 ",
          apple_private_key: "ignored when a file is chosen",
          apple_services_id: " com.example.web ",
          apple_team_id: "abcde12345",
          google_enabled: "on",
          google_ios_client_id: "",
          google_web_client_id: ` ${WEB_CLIENT_ID} `,
        },
        { apple_private_key_file: new File([`${APPLE_KEY}\n`], "AuthKey.p8") }
      )
    );

    expect(result).toEqual({
      message: "The sign-in providers were saved.",
      ok: true,
    });
    expect(mockAssertSameOrigin).toHaveBeenCalled();
    expect(mockUpdateTenantSignInSettings).toHaveBeenCalledWith(
      {
        apple: {
          enabled: true,
          keyId: "2X9R4HXF34",
          privateKey: { mode: 2, value: APPLE_KEY },
          servicesId: "com.example.web",
          teamId: "ABCDE12345",
        },
        google: {
          enabled: true,
          iosClientId: "",
          webClientId: WEB_CLIENT_ID,
        },
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith(
      "tenant:TENANT001:sign-in-settings"
    );
  });

  it("keeps a stored key, and switching a provider off keeps what it had", async () => {
    mockUpdateTenantSignInSettings.mockResolvedValue({
      ok: true,
      settings: {},
    });

    const { updateTenantSignInSettingsAction } = await import("./actions");
    await updateTenantSignInSettingsAction(
      null,
      signInFormData({
        apple_enabled: "on",
        apple_key_id: "2X9R4HXF34",
        apple_private_key_configured: "1",
        apple_private_key_mode: "keep",
        apple_team_id: "ABCDE12345",
        google_ios_client_id: IOS_CLIENT_ID,
      })
    );

    expect(mockUpdateTenantSignInSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({
        apple: expect.objectContaining({
          enabled: true,
          privateKey: { mode: 1, value: "" },
        }),
        google: {
          enabled: false,
          iosClientId: IOS_CLIENT_ID,
          webClientId: "",
        },
      }),
      "en"
    );

    await updateTenantSignInSettingsAction(
      null,
      signInFormData({
        apple_private_key_configured: "1",
        apple_private_key_mode: "clear",
      })
    );

    expect(mockUpdateTenantSignInSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({
        apple: expect.objectContaining({
          enabled: false,
          privateKey: { mode: 3, value: "" },
        }),
      }),
      "en"
    );
  });

  it("asks for everything an enabled provider needs before saving", async () => {
    const { updateTenantSignInSettingsAction } = await import("./actions");
    const result = await updateTenantSignInSettingsAction(
      null,
      signInFormData({
        apple_enabled: "on",
        apple_private_key_configured: "1",
        apple_private_key_mode: "clear",
        google_enabled: "on",
      })
    );

    expect(result).toEqual({
      fieldErrors: {
        keyId: "Enter the Key ID to offer Sign in with Apple.",
        privateKey:
          "Choose or paste the private key to offer Sign in with Apple.",
        teamId: "Enter the Team ID to offer Sign in with Apple.",
        webClientId:
          "Enter at least one client ID to offer Sign in with Google.",
      },
      message: VALIDATION,
      ok: false,
    });
    expect(mockUpdateTenantSignInSettings).not.toHaveBeenCalled();
  });

  it("refuses a malformed value whether or not its provider is on", async () => {
    const { updateTenantSignInSettingsAction } = await import("./actions");
    const result = await updateTenantSignInSettingsAction(
      null,
      signInFormData({
        apple_key_id: "KEY",
        apple_services_id: "web",
        apple_team_id: "ABCDE-1234",
        google_ios_client_id: "ios.example.com",
        google_web_client_id: WEB_CLIENT_ID,
      })
    );

    expect(result).toEqual({
      fieldErrors: {
        iosClientId:
          "Enter a client ID ending in .apps.googleusercontent.com, as the Google Cloud console shows it.",
        keyId:
          "Enter the Key ID as ten capital letters and digits, such as 2X9R4HXF34.",
        servicesId:
          "Enter the Services ID as two or more dot-separated parts of letters, digits, and hyphens, such as com.example.web.",
        teamId:
          "Enter the Team ID as ten capital letters and digits, such as ABCDE12345.",
      },
      message: VALIDATION,
      ok: false,
    });
    expect(mockUpdateTenantSignInSettings).not.toHaveBeenCalled();
  });

  it("refuses a file too large to be a key", async () => {
    const { updateTenantSignInSettingsAction } = await import("./actions");
    const result = await updateTenantSignInSettingsAction(
      null,
      signInFormData(
        {},
        {
          apple_private_key_file: new File(
            ["x".repeat(64 * 1024 + 1)],
            "AuthKey.p8"
          ),
        }
      )
    );

    expect(result).toEqual({
      fieldErrors: { privateKey: "This file is too large to be a key file." },
      message: VALIDATION,
      ok: false,
    });
    expect(mockUpdateTenantSignInSettings).not.toHaveBeenCalled();
  });

  it("does not save without a tenant", async () => {
    const { updateTenantSignInSettingsAction } = await import("./actions");
    const result = await updateTenantSignInSettingsAction(
      null,
      signInFormData({ tenant_id: " " })
    );

    expect(result).toMatchObject({ message: VALIDATION, ok: false });
    expect(mockUpdateTenantSignInSettings).not.toHaveBeenCalled();
  });

  it("passes on the fields the API refused and leaves the cache tag alone", async () => {
    const refused = {
      fieldErrors: {
        privateKey:
          "The key was refused. Choose the .p8 file the Apple Developer account issued for Sign in with Apple.",
      },
      message: VALIDATION,
      ok: false,
    };
    mockUpdateTenantSignInSettings.mockResolvedValueOnce(refused);

    const { updateTenantSignInSettingsAction } = await import("./actions");
    const result = await updateTenantSignInSettingsAction(
      null,
      signInFormData({ apple_private_key: "not a key" })
    );

    expect(result).toEqual(refused);
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});
