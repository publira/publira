import {
  BadRequestSchema,
  Code,
  ConnectError,
} from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UpdateTenantSignInSettingsInput } from "./tenant-sign-in-settings";

const {
  mockCacheLife,
  mockCacheTag,
  mockGetAccessToken,
  mockGetTenantSignInSettingsApi,
  mockUpdateTenantSignInSettingsApi,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetTenantSignInSettingsApi: vi.fn(),
  mockUpdateTenantSignInSettingsApi: vi.fn(),
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
      getTenantSignInSettings: mockGetTenantSignInSettingsApi,
      updateTenantSignInSettings: mockUpdateTenantSignInSettingsApi,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

const WEB_CLIENT_ID = "1234-abc.apps.googleusercontent.com";
const IOS_CLIENT_ID = "1234-ios.apps.googleusercontent.com";

const STORED = {
  apple: {
    bundleIdentifier: "com.example.reader",
    enabled: true,
    keyId: "KEY1234567",
    privateKeyConfigured: true,
    privateKeyHint: "MIGT…abcd",
    ready: true,
    servicesId: "com.example.web",
    teamId: "TEAM123456",
  },
  google: {
    enabled: true,
    iosClientId: IOS_CLIENT_ID,
    ready: true,
    webClientId: WEB_CLIENT_ID,
  },
};

const INPUT: UpdateTenantSignInSettingsInput = {
  apple: {
    enabled: true,
    keyId: "KEY1234567",
    privateKey: { mode: 2, value: "-----BEGIN PRIVATE KEY-----" },
    servicesId: "com.example.web",
    teamId: "TEAM123456",
  },
  google: {
    enabled: true,
    iosClientId: "",
    webClientId: WEB_CLIENT_ID,
  },
  tenantId: " TENANT001 ",
};

const fieldViolation = (field: string) =>
  new ConnectError("rejected", Code.InvalidArgument, undefined, [
    { desc: BadRequestSchema, value: { fieldViolations: [{ field }] } },
  ]);

describe("tenant-sign-in-settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("reads both providers under the tenant's tag", async () => {
    mockGetTenantSignInSettingsApi.mockResolvedValueOnce({ settings: STORED });

    const { getTenantSignInSettings } =
      await import("./tenant-sign-in-settings");
    const result = await getTenantSignInSettings("TENANT001", "en");

    expect(result).toEqual({ ok: true, settings: STORED });
    expect(mockGetTenantSignInSettingsApi).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockCacheTag).toHaveBeenCalledWith(
      "tenant:TENANT001:sign-in-settings"
    );
    expect(mockCacheLife).not.toHaveBeenCalled();
  });

  it("reads a tenant that saved nothing as both providers off", async () => {
    mockGetTenantSignInSettingsApi.mockResolvedValueOnce({});

    const { getTenantSignInSettings } =
      await import("./tenant-sign-in-settings");
    const result = await getTenantSignInSettings("TENANT001", "en");

    expect(result).toEqual({
      ok: true,
      settings: {
        apple: {
          bundleIdentifier: "",
          enabled: false,
          keyId: "",
          privateKeyConfigured: false,
          privateKeyHint: "",
          ready: false,
          servicesId: "",
          teamId: "",
        },
        google: {
          enabled: false,
          iosClientId: "",
          ready: false,
          webClientId: "",
        },
      },
    });
  });

  it("asks for a sign-in when there is no session", async () => {
    mockGetAccessToken.mockResolvedValueOnce("");

    const { getTenantSignInSettings } =
      await import("./tenant-sign-in-settings");
    const result = await getTenantSignInSettings("TENANT001", "en");

    expect(result).toMatchObject({ ok: false, requiresSignIn: true });
    expect(mockGetTenantSignInSettingsApi).not.toHaveBeenCalled();
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("reports a read the API could not answer and does not keep it", async () => {
    mockGetTenantSignInSettingsApi.mockRejectedValueOnce(
      new ConnectError("down", Code.Unavailable)
    );

    const { getTenantSignInSettings } =
      await import("./tenant-sign-in-settings");
    const result = await getTenantSignInSettings("TENANT001", "en");

    expect(result).toMatchObject({
      message: "Could not connect to the server. Please try again later.",
      ok: false,
      requiresSignIn: false,
    });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("writes both providers with the key's update mode", async () => {
    mockUpdateTenantSignInSettingsApi.mockResolvedValueOnce({
      settings: STORED,
    });

    const { updateTenantSignInSettings } =
      await import("./tenant-sign-in-settings");
    const result = await updateTenantSignInSettings(INPUT, "en");

    expect(result).toEqual({ ok: true, settings: STORED });
    expect(mockUpdateTenantSignInSettingsApi).toHaveBeenCalledWith(
      {
        apple: {
          enabled: true,
          keyId: "KEY1234567",
          privateKey: "-----BEGIN PRIVATE KEY-----",
          privateKeyUpdateMode: 2,
          servicesId: "com.example.web",
          teamId: "TEAM123456",
        },
        google: {
          enabled: true,
          iosClientId: "",
          webClientId: WEB_CLIENT_ID,
        },
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("names the Apple field the API refused", async () => {
    mockUpdateTenantSignInSettingsApi.mockRejectedValueOnce(
      fieldViolation("apple.private_key")
    );

    const { updateTenantSignInSettings } =
      await import("./tenant-sign-in-settings");
    const result = await updateTenantSignInSettings(INPUT, "en");

    expect(result).toEqual({
      fieldErrors: {
        privateKey:
          "The key was refused. Choose the .p8 file the Apple Developer account issued for Sign in with Apple.",
      },
      message: "Please check the information you entered.",
      ok: false,
    });
  });

  it("puts a refused Google client ID on each ID that was entered", async () => {
    mockUpdateTenantSignInSettingsApi.mockRejectedValueOnce(
      fieldViolation("google")
    );

    const { updateTenantSignInSettings } =
      await import("./tenant-sign-in-settings");
    const result = await updateTenantSignInSettings(INPUT, "en");

    expect(result).toMatchObject({
      fieldErrors: {
        webClientId:
          "Enter a client ID ending in .apps.googleusercontent.com, as the Google Cloud console shows it.",
      },
      ok: false,
    });
    expect(result.ok ? undefined : result.fieldErrors).not.toHaveProperty(
      "iosClientId"
    );
  });

  it("falls back to the save message for a refusal no field explains", async () => {
    mockUpdateTenantSignInSettingsApi.mockRejectedValueOnce(
      new ConnectError("down", Code.Unavailable)
    );

    const { updateTenantSignInSettings } =
      await import("./tenant-sign-in-settings");
    const result = await updateTenantSignInSettings(INPUT, "en");

    expect(result).toEqual({
      message: "Could not connect to the server. Please try again later.",
      ok: false,
    });
  });

  it("rethrows a session the API rejected", async () => {
    const error = new ConnectError("expired", Code.Unauthenticated);
    mockUpdateTenantSignInSettingsApi.mockRejectedValueOnce(error);

    const { updateTenantSignInSettings } =
      await import("./tenant-sign-in-settings");

    await expect(updateTenantSignInSettings(INPUT, "en")).rejects.toBe(error);
  });
});
