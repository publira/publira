import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  SEARCH_PASSWORD_CLEAR,
  SEARCH_PASSWORD_UNCHANGED,
} from "#lib/search-settings-shared";

const {
  mockAssertSameOrigin,
  mockGetPlatformLocale,
  mockResolveAccessToken,
  mockTestPlatformSearchConnection,
  mockUpdatePlatformSearchSettings,
  mockUpdateTag,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockGetPlatformLocale: vi.fn(),
  mockResolveAccessToken: vi.fn(),
  mockTestPlatformSearchConnection: vi.fn(),
  mockUpdatePlatformSearchSettings: vi.fn(),
  mockUpdateTag: vi.fn(),
}));

vi.mock("next/cache", () => ({
  updateTag: mockUpdateTag,
}));

vi.mock("#lib/audit-logs", () => ({
  platformAuditLogsCacheTag: "platform:audit-logs",
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/api-client", () => ({
  resolveAccessToken: mockResolveAccessToken,
}));

vi.mock("#lib/locale", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    getPlatformLocale: mockGetPlatformLocale,
  };
});

vi.mock("#lib/search-settings", () => ({
  platformSearchSettingsCacheTag: "platform:search-settings",
  testPlatformSearchConnection: mockTestPlatformSearchConnection,
  updatePlatformSearchSettings: mockUpdatePlatformSearchSettings,
}));

const searchFormData = (fields: Record<string, string>): FormData => {
  const formData = new FormData();
  for (const [name, value] of Object.entries({ revision: "3", ...fields })) {
    formData.set(name, value);
  }
  return formData;
};

const openSearchForm = searchFormData({
  credential_mode: "basic",
  engine: "opensearch",
  password_update_mode: String(SEARCH_PASSWORD_UNCHANGED),
  url: "https://search.example.com",
  username: "publira",
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  // `withPlatformSessionReauth` resolves the session before the mutation
  // runs; without a token the Action would redirect to /login.
  mockResolveAccessToken.mockResolvedValue("session-token");
  mockGetPlatformLocale.mockResolvedValue("en");
});

describe("updatePlatformSearchSettingsAction", () => {
  it("saves at the rendered revision and clears the settings and the audit log", async () => {
    mockUpdatePlatformSearchSettings.mockResolvedValueOnce({
      ok: true,
      settings: { buildState: "serving", revision: "4" },
    });

    const { updatePlatformSearchSettingsAction } = await import("./actions");

    await expect(
      updatePlatformSearchSettingsAction(
        null,
        searchFormData({ engine: "sql" })
      )
    ).resolves.toEqual({ message: "Search settings saved.", ok: true });
    expect(mockUpdatePlatformSearchSettings).toHaveBeenCalledWith(
      {
        engine: "sql",
        index: "",
        password: "",
        passwordUpdateMode: SEARCH_PASSWORD_CLEAR,
        url: "",
        username: "",
      },
      3n,
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("platform:search-settings");
    expect(mockUpdateTag).toHaveBeenCalledWith("platform:audit-logs");
  });

  it("says the index is being built when the save named a new target", async () => {
    mockUpdatePlatformSearchSettings.mockResolvedValueOnce({
      ok: true,
      settings: { buildState: "building", revision: "4" },
    });

    const { updatePlatformSearchSettingsAction } = await import("./actions");

    await expect(
      updatePlatformSearchSettingsAction(null, openSearchForm)
    ).resolves.toEqual({
      message:
        "Search settings saved. The index is being built now, and the search moves to the new engine once it's ready.",
      ok: true,
    });
  });

  it("refuses an incomplete form without a round trip", async () => {
    const { updatePlatformSearchSettingsAction } = await import("./actions");

    await expect(
      updatePlatformSearchSettingsAction(
        null,
        searchFormData({ engine: "opensearch" })
      )
    ).resolves.toMatchObject({ ok: false });
    expect(mockUpdatePlatformSearchSettings).not.toHaveBeenCalled();
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });

  it("reports a refused save and clears nothing", async () => {
    mockUpdatePlatformSearchSettings.mockResolvedValueOnce({
      message: "Another operator changed the search settings.",
      ok: false,
    });

    const { updatePlatformSearchSettingsAction } = await import("./actions");

    await expect(
      updatePlatformSearchSettingsAction(null, openSearchForm)
    ).resolves.toEqual({
      message: "Another operator changed the search settings.",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});

describe("testPlatformSearchConnectionAction", () => {
  it("returns what the engine answered and clears the audit log, which records every test", async () => {
    const result = {
      failure:
        "The engine is missing a plugin the catalog index needs: analysis-icu. Install it on every node and test again.",
      icuInstalled: false,
      kuromojiInstalled: true,
      product: "OpenSearch",
      succeeded: false,
      version: "3.2.0",
    };
    mockTestPlatformSearchConnection.mockResolvedValueOnce({
      ok: true,
      result,
    });

    const { testPlatformSearchConnectionAction } = await import("./actions");

    await expect(
      testPlatformSearchConnectionAction(null, openSearchForm)
    ).resolves.toEqual({ message: result.failure, ok: false, result });
    expect(mockTestPlatformSearchConnection).toHaveBeenCalledWith(
      {
        engine: "opensearch",
        index: "",
        password: "",
        passwordUpdateMode: SEARCH_PASSWORD_UNCHANGED,
        url: "https://search.example.com",
        username: "publira",
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("platform:audit-logs");
    expect(mockUpdateTag).not.toHaveBeenCalledWith("platform:search-settings");
  });

  it("words a passing test", async () => {
    mockTestPlatformSearchConnection.mockResolvedValueOnce({
      ok: true,
      result: {
        failure: "",
        icuInstalled: true,
        kuromojiInstalled: true,
        product: "OpenSearch",
        succeeded: true,
        version: "3.2.0",
      },
    });

    const { testPlatformSearchConnectionAction } = await import("./actions");

    await expect(
      testPlatformSearchConnectionAction(null, openSearchForm)
    ).resolves.toMatchObject({
      message:
        "The connection works, and the engine has both plugins the catalog index needs.",
      ok: true,
    });
  });
});
