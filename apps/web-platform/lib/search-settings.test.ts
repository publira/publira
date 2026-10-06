import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getPlatformSearchSettings,
  platformSearchSettingsCacheTag,
  searchTestFailureMessage,
  testPlatformSearchConnection,
  updatePlatformSearchSettings,
} from "./search-settings";
import type { PlatformSearchInput } from "./search-settings";
import {
  SEARCH_PASSWORD_REPLACE,
  SEARCH_PASSWORD_UNCHANGED,
} from "./search-settings-shared";

const {
  mockCacheLife,
  mockCacheTag,
  mockGetPlatformLocale,
  mockGetPlatformSearchSettings,
  mockResolveSessionId,
  mockTestPlatformSearchConnection,
  mockUpdatePlatformSearchSettings,
  mockVerifyPlatformSession,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockGetPlatformLocale: vi.fn(),
  mockGetPlatformSearchSettings: vi.fn(),
  mockResolveSessionId: vi.fn(),
  mockTestPlatformSearchConnection: vi.fn(),
  mockUpdatePlatformSearchSettings: vi.fn(),
  mockVerifyPlatformSession: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheLife: mockCacheLife,
  cacheTag: mockCacheTag,
}));

vi.mock("./auth-session", () => ({
  verifyPlatformSession: mockVerifyPlatformSession,
}));

vi.mock("./locale", () => ({
  getPlatformLocale: mockGetPlatformLocale,
}));

vi.mock("./api-client", () => ({
  SHARED_READ_CACHE_LIFE: "minutes",
  apiClient: {
    searchSettings: {
      getPlatformSearchSettings: mockGetPlatformSearchSettings,
      testPlatformSearchConnection: mockTestPlatformSearchConnection,
      updatePlatformSearchSettings: mockUpdatePlatformSearchSettings,
    },
  },
  buildSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
  resolveAccessToken: mockResolveSessionId,
  withServiceHeaders: () => ({
    headers: { Authorization: "Bearer service-token" },
  }),
}));

/** OpenSearch saved and answering, the way the API reports it. */
const servingSettings = {
  buildState: 1,
  engine: 2,
  hasPassword: true,
  index: "publira-catalog",
  revision: 3n,
  serving: {
    engine: 2,
    index: "publira-catalog",
    revision: 3n,
    since: "2026-10-01T00:00:00Z",
    url: "https://search.example.com",
  },
  url: "https://search.example.com",
  username: "publira",
};

const input: PlatformSearchInput = {
  engine: "opensearch",
  index: "publira-catalog",
  password: "",
  passwordUpdateMode: SEARCH_PASSWORD_UNCHANGED,
  url: "https://search.example.com",
  username: "publira",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveSessionId.mockResolvedValue("sess_abc");
  mockGetPlatformLocale.mockResolvedValue("en");
  mockVerifyPlatformSession.mockResolvedValue({
    name: "Admin",
    publicId: "usr_1",
    role: "platform_super_admin",
  });
});

describe("getPlatformSearchSettings", () => {
  it("returns the saved values, what the search answers from, and the revision as a decimal string", async () => {
    mockGetPlatformSearchSettings.mockResolvedValueOnce({
      settings: servingSettings,
    });

    await expect(getPlatformSearchSettings()).resolves.toEqual({
      ok: true,
      settings: {
        buildFailure: null,
        buildState: "serving",
        engine: "opensearch",
        hasPassword: true,
        index: "publira-catalog",
        revision: "3",
        serving: {
          engine: "opensearch",
          index: "publira-catalog",
          revision: "3",
          since: "2026-10-01T00:00:00Z",
          url: "https://search.example.com",
        },
        url: "https://search.example.com",
        username: "publira",
      },
    });
    expect(mockGetPlatformSearchSettings).toHaveBeenCalledWith(
      {},
      { headers: { Authorization: "Bearer service-token" } }
    );
    expect(platformSearchSettingsCacheTag).toBe("platform:search-settings");
    expect(mockCacheTag).toHaveBeenCalledWith(platformSearchSettingsCacheTag);
    expect(mockCacheLife).toHaveBeenCalledWith("minutes");
  });

  it("reads a platform with nothing saved as the SQL engine at revision 0", async () => {
    mockGetPlatformSearchSettings.mockResolvedValueOnce({ settings: {} });

    await expect(getPlatformSearchSettings()).resolves.toMatchObject({
      ok: true,
      settings: {
        buildState: "serving",
        engine: "sql",
        revision: "0",
        serving: { engine: "sql", revision: "0", since: "" },
      },
    });
  });

  // The worker finishes a build without a write through this console, so an
  // entry holding a pending build must not outlive the screen's own refresh.
  it("keeps a pending build for seconds rather than minutes", async () => {
    mockGetPlatformSearchSettings.mockResolvedValueOnce({
      settings: {
        ...servingSettings,
        buildState: 2,
        revision: 4n,
        serving: { engine: 1, index: "", revision: 2n, since: "", url: "" },
      },
    });

    await expect(getPlatformSearchSettings()).resolves.toMatchObject({
      ok: true,
      settings: {
        buildFailure: null,
        buildState: "building",
        serving: { engine: "sql", revision: "2" },
      },
    });
    expect(mockCacheLife).toHaveBeenCalledWith("seconds");
    expect(mockCacheLife).not.toHaveBeenCalledWith("minutes");
  });

  it("carries the failure of the last build", async () => {
    mockGetPlatformSearchSettings.mockResolvedValueOnce({
      settings: {
        ...servingSettings,
        buildFailure: {
          error: "index_not_found_exception",
          failedAt: "2026-10-02T03:04:05Z",
        },
        buildState: 3,
      },
    });

    await expect(getPlatformSearchSettings()).resolves.toMatchObject({
      ok: true,
      settings: {
        buildFailure: {
          error: "index_not_found_exception",
          failedAt: "2026-10-02T03:04:05Z",
        },
        buildState: "failed",
      },
    });
  });

  it("leaves the API uncalled when the session is rejected", async () => {
    mockVerifyPlatformSession.mockRejectedValueOnce(
      new Error("NEXT_REDIRECT:/login")
    );

    await expect(getPlatformSearchSettings()).rejects.toThrow(/NEXT_REDIRECT/u);
    expect(mockGetPlatformSearchSettings).not.toHaveBeenCalled();
  });

  it("returns a failure as a value instead of throwing inside the cache scope", async () => {
    mockGetPlatformSearchSettings.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    await expect(getPlatformSearchSettings()).resolves.toMatchObject({
      ok: false,
    });
  });
});

describe("updatePlatformSearchSettings", () => {
  it("sends the form values as the API's enum with the revision the screen was rendered at", async () => {
    mockUpdatePlatformSearchSettings.mockResolvedValueOnce({
      settings: { ...servingSettings, buildState: 2, revision: 4n },
    });

    const result = await updatePlatformSearchSettings(input, 3n, "en");

    expect(mockUpdatePlatformSearchSettings).toHaveBeenCalledWith(
      {
        engine: 2,
        expectedRevision: 3n,
        index: "publira-catalog",
        password: "",
        passwordUpdateMode: SEARCH_PASSWORD_UNCHANGED,
        url: "https://search.example.com",
        username: "publira",
      },
      { headers: { Authorization: "Bearer sess_abc" } }
    );
    expect(result).toMatchObject({
      ok: true,
      settings: { buildState: "building", revision: "4" },
    });
  });

  it("names Elasticsearch by its own enum value", async () => {
    mockUpdatePlatformSearchSettings.mockResolvedValueOnce({
      settings: servingSettings,
    });

    await updatePlatformSearchSettings(
      { ...input, engine: "elasticsearch" },
      3n,
      "en"
    );

    expect(mockUpdatePlatformSearchSettings).toHaveBeenCalledWith(
      expect.objectContaining({ engine: 3 }),
      expect.anything()
    );
  });

  it("tells the operator to reload when another session saved first", async () => {
    mockUpdatePlatformSearchSettings.mockRejectedValueOnce(
      new ConnectError(
        "platform search settings have changed since they were read",
        Code.FailedPrecondition
      )
    );

    await expect(
      updatePlatformSearchSettings(input, 3n, "en")
    ).resolves.toEqual({
      message:
        "Another operator changed the search settings, so nothing was saved. Reload the screen and try again.",
      ok: false,
    });
  });

  it("passes the server's validation detail through", async () => {
    mockUpdatePlatformSearchSettings.mockRejectedValueOnce(
      new ConnectError(
        "credentials need an https:// URL; over http:// they would cross the network in cleartext",
        Code.InvalidArgument
      )
    );

    await expect(
      updatePlatformSearchSettings(
        {
          ...input,
          password: "s3cret",
          passwordUpdateMode: SEARCH_PASSWORD_REPLACE,
          url: "http://search.example.com",
        },
        3n,
        "en"
      )
    ).resolves.toEqual({
      message:
        "credentials need an https:// URL; over http:// they would cross the network in cleartext",
      ok: false,
    });
  });
});

describe("testPlatformSearchConnection", () => {
  it("reports the engine, its version, and both plugins when the test passed", async () => {
    mockTestPlatformSearchConnection.mockResolvedValueOnce({
      analysisIcuInstalled: true,
      analysisKuromojiInstalled: true,
      product: "OpenSearch",
      reason: "",
      succeeded: true,
      version: "3.2.0",
    });

    await expect(testPlatformSearchConnection(input, "en")).resolves.toEqual({
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
    expect(mockTestPlatformSearchConnection).toHaveBeenCalledWith(
      {
        engine: 2,
        password: "",
        passwordUpdateMode: SEARCH_PASSWORD_UNCHANGED,
        url: "https://search.example.com",
        username: "publira",
      },
      { headers: { Authorization: "Bearer sess_abc" } }
    );
  });

  it.each([
    [false, true, "analysis-kuromoji"],
    [true, false, "analysis-icu"],
    [false, false, "analysis-kuromoji, analysis-icu"],
  ])(
    "names the plugin the engine lacks (kuromoji %s, icu %s)",
    async (kuromoji, icu, missing) => {
      mockTestPlatformSearchConnection.mockResolvedValueOnce({
        analysisIcuInstalled: icu,
        analysisKuromojiInstalled: kuromoji,
        product: "OpenSearch",
        reason: "SEARCH_TEST_PLUGIN_MISSING",
        succeeded: false,
        version: "3.2.0",
      });

      const result = await testPlatformSearchConnection(input, "en");

      expect(result).toMatchObject({ ok: true, result: { succeeded: false } });
      expect(result.ok && result.result.failure).toBe(
        `The engine is missing a plugin the catalog index needs: ${missing}. Install it on every node and test again.`
      );
    }
  );

  it("words an engine that did not answer by its reason", async () => {
    mockTestPlatformSearchConnection.mockResolvedValueOnce({
      analysisIcuInstalled: false,
      analysisKuromojiInstalled: false,
      product: "",
      reason: "SEARCH_TEST_UNREACHABLE",
      succeeded: false,
      version: "",
    });

    const result = await testPlatformSearchConnection(input, "en");

    expect(result.ok && result.result.failure).toMatch(/^Connection failed/u);
  });

  it("falls back to the unknown wording for a reason this console does not know", async () => {
    mockTestPlatformSearchConnection.mockResolvedValueOnce({
      analysisIcuInstalled: false,
      analysisKuromojiInstalled: false,
      product: "",
      reason: "SEARCH_TEST_SOMETHING_NEW",
      succeeded: false,
      version: "",
    });

    const result = await testPlatformSearchConnection(input, "en");

    expect(result.ok && result.result.failure).toBe(
      "The test failed for a reason Publira doesn't recognize."
    );
  });

  it("reports a test the API refused to run", async () => {
    mockTestPlatformSearchConnection.mockRejectedValueOnce(
      new ConnectError(
        "the sql engine connects to nothing beside the database, so there is nothing to test",
        Code.InvalidArgument
      )
    );

    await expect(
      testPlatformSearchConnection({ ...input, engine: "sql" }, "en")
    ).resolves.toEqual({
      message:
        "the sql engine connects to nothing beside the database, so there is nothing to test",
      ok: false,
    });
  });
});

describe("searchTestFailureMessage", () => {
  it.each([
    ["SEARCH_TEST_UNREACHABLE", /^Connection failed/u],
    ["SEARCH_TEST_UNAUTHORIZED", /^Authentication failed/u],
    ["SEARCH_TEST_NOT_A_SEARCH_ENGINE", /not a search engine/u],
    ["SEARCH_TEST_WRONG_PRODUCT", /isn't the one selected/u],
    ["SEARCH_TEST_PLUGIN_MISSING", /analysis-kuromoji or analysis-icu/u],
  ])("words %s for the audit log", async (reason, wording) => {
    await expect(searchTestFailureMessage(reason, "en")).resolves.toMatch(
      wording
    );
  });

  it("answers undefined for a reason it does not know", async () => {
    await expect(
      searchTestFailureMessage("STORAGE_TEST_TIMEOUT", "en")
    ).resolves.toBeUndefined();
  });
});
