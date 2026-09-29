import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  emailConfigurationState,
  getRequiredConfigurationState,
  policyConfigurationState,
  storageConfigurationState,
  webPushConfigurationState,
} from "./configuration-status";

const { mockGetPlatformEmailSettings, mockGetPlatformStorageSettings } =
  vi.hoisted(() => ({
    mockGetPlatformEmailSettings: vi.fn(),
    mockGetPlatformStorageSettings: vi.fn(),
  }));

vi.mock("./email-settings", () => ({
  getPlatformEmailSettings: mockGetPlatformEmailSettings,
}));

vi.mock("./storage-settings", () => ({
  getPlatformStorageSettings: mockGetPlatformStorageSettings,
}));

const savedEmail = {
  ok: true,
  settings: { hasPassword: true, host: "smtp.example.com" },
};
const savedStorage = { ok: true, settings: { revision: "3" } };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetPlatformEmailSettings.mockResolvedValue(savedEmail);
  mockGetPlatformStorageSettings.mockResolvedValue(savedStorage);
});

describe("emailConfigurationState", () => {
  it("is configured once a server and its password are saved", () => {
    expect(
      emailConfigurationState({ hasPassword: true, host: "smtp.example.com" })
    ).toBe("configured");
  });

  it("needs setup while no server is saved", () => {
    expect(emailConfigurationState({ hasPassword: false, host: "" })).toBe(
      "needs_setup"
    );
    expect(emailConfigurationState({ hasPassword: true, host: "  " })).toBe(
      "needs_setup"
    );
  });

  it("needs setup while the password is missing, since no mail can be sent", () => {
    expect(
      emailConfigurationState({ hasPassword: false, host: "smtp.example.com" })
    ).toBe("needs_setup");
  });
});

describe("storageConfigurationState", () => {
  it("needs setup until a configuration is saved", () => {
    expect(storageConfigurationState({ revision: "0" })).toBe("needs_setup");
  });

  it("is configured at any saved revision", () => {
    expect(storageConfigurationState({ revision: "4" })).toBe("configured");
  });
});

describe("webPushConfigurationState", () => {
  it("is an optional integration left off, not one that needs setup", () => {
    expect(webPushConfigurationState({ configured: false })).toBe(
      "not_configured"
    );
  });

  it("is configured once a subject is saved", () => {
    expect(webPushConfigurationState({ configured: true })).toBe("configured");
  });
});

describe("policyConfigurationState", () => {
  it("runs on the built-in defaults while no policy row is saved", () => {
    expect(policyConfigurationState(["0", "0"])).toBe("defaults");
  });

  it("is configured once any of the rows is saved", () => {
    expect(policyConfigurationState(["0", "2"])).toBe("configured");
    expect(policyConfigurationState(["5", "0"])).toBe("configured");
  });
});

describe("getRequiredConfigurationState", () => {
  it("is ready once email and storage are both saved", async () => {
    await expect(getRequiredConfigurationState("en")).resolves.toBe("ready");
    expect(mockGetPlatformEmailSettings).toHaveBeenCalledWith("en");
    expect(mockGetPlatformStorageSettings).toHaveBeenCalledWith("en");
  });

  it("needs setup while storage has never been saved", async () => {
    mockGetPlatformStorageSettings.mockResolvedValueOnce({
      ok: true,
      settings: { revision: "0" },
    });

    await expect(getRequiredConfigurationState("en")).resolves.toBe(
      "needs_setup"
    );
  });

  it("needs setup when one read shows a gap even though the other failed", async () => {
    mockGetPlatformEmailSettings.mockResolvedValueOnce({
      ok: true,
      settings: { hasPassword: false, host: "" },
    });
    mockGetPlatformStorageSettings.mockResolvedValueOnce({
      message: "Could not load the storage settings.",
      ok: false,
      requiresSignIn: false,
    });

    await expect(getRequiredConfigurationState("en")).resolves.toBe(
      "needs_setup"
    );
  });

  it("claims neither answer when a read failed and the other shows no gap", async () => {
    mockGetPlatformEmailSettings.mockResolvedValueOnce({
      message: "Unauthenticated.",
      ok: false,
      requiresSignIn: true,
    });

    await expect(getRequiredConfigurationState("en")).resolves.toBe("unknown");
  });
});
