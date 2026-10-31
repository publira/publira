import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as LocaleModule from "#lib/locale";
import {
  SEARCH_PASSWORD_CLEAR,
  SEARCH_PASSWORD_UNCHANGED,
} from "#lib/search-settings-shared";

const {
  mockAssertSameOrigin,
  mockGetPlatformLocale,
  mockGetPlatformSearchSettings,
  mockResolveAccessToken,
  mockTestPlatformSearchConnection,
  mockUpdatePlatformSearchSettings,
  mockUpdateTag,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockGetPlatformLocale: vi.fn(),
  mockGetPlatformSearchSettings: vi.fn(),
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
  const actual = await importOriginal<typeof LocaleModule>();

  return {
    ...actual,
    getPlatformLocale: mockGetPlatformLocale,
  };
});

vi.mock("#lib/search-settings", () => ({
  getPlatformSearchSettings: mockGetPlatformSearchSettings,
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

/** OpenSearch as saved at revision 3, with a stored credential. */
const savedOpenSearch = {
  engine: "opensearch",
  hasPassword: true,
  index: "publira-catalog",
  revision: "3",
  url: "https://search.example.com",
  username: "publira",
};

const NORI_DEFINITION = JSON.stringify({
  analyzer: {
    alternate_form: { tokenizer: "nori_tokenizer", type: "custom" },
    written_form: { tokenizer: "nori_tokenizer", type: "custom" },
  },
  normalizer: { exact_match: { filter: ["lowercase"], type: "custom" } },
});

describe("updatePlatformSearchAnalysisAction", () => {
  beforeEach(() => {
    mockGetPlatformSearchSettings.mockResolvedValue({
      ok: true,
      settings: savedOpenSearch,
    });
  });

  it("restates the saved engine and credential with the new definition, and clears the settings and the audit log", async () => {
    mockUpdatePlatformSearchSettings.mockResolvedValueOnce({
      ok: true,
      settings: { buildState: "building", revision: "4" },
    });

    const { updatePlatformSearchAnalysisAction } = await import("./actions");

    await expect(
      updatePlatformSearchAnalysisAction(
        null,
        searchFormData({ analysis: NORI_DEFINITION, intent: "replace" })
      )
    ).resolves.toEqual({
      message:
        "Text analysis saved. A new index is being built with it, and the search moves onto it once it's ready.",
      ok: true,
    });
    expect(mockUpdatePlatformSearchSettings).toHaveBeenCalledWith(
      {
        analysis: { definition: NORI_DEFINITION, mode: "replace" },
        engine: "opensearch",
        index: "publira-catalog",
        password: "",
        passwordUpdateMode: SEARCH_PASSWORD_UNCHANGED,
        url: "https://search.example.com",
        username: "publira",
      },
      3n,
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("platform:search-settings");
    expect(mockUpdateTag).toHaveBeenCalledWith("platform:audit-logs");
  });

  it("goes back to the default whatever the editor holds", async () => {
    mockUpdatePlatformSearchSettings.mockResolvedValueOnce({
      ok: true,
      settings: { buildState: "building", revision: "4" },
    });

    const { updatePlatformSearchAnalysisAction } = await import("./actions");

    await updatePlatformSearchAnalysisAction(
      null,
      searchFormData({ analysis: "not json", intent: "default" })
    );

    expect(mockUpdatePlatformSearchSettings).toHaveBeenCalledWith(
      expect.objectContaining({ analysis: { mode: "default" } }),
      3n,
      "en"
    );
  });

  it("puts the reason a refused definition was refused next to the editor", async () => {
    const reason =
      "the search engine refused the analysis definition: illegal_argument_exception: Unknown tokenizer type [nori_tokenizer]";

    mockUpdatePlatformSearchSettings.mockResolvedValueOnce({
      fieldErrors: { analysis: reason },
      message: reason,
      ok: false,
    });

    const { updatePlatformSearchAnalysisAction } = await import("./actions");

    await expect(
      updatePlatformSearchAnalysisAction(
        null,
        searchFormData({ analysis: NORI_DEFINITION, intent: "replace" })
      )
    ).resolves.toEqual({
      fieldErrors: { analysis: reason },
      message: "The definition wasn't saved. Fix it and save again.",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });

  it("saves a definition as one language's own and leaves the shared one as it is", async () => {
    mockUpdatePlatformSearchSettings.mockResolvedValueOnce({
      ok: true,
      settings: { buildState: "building", revision: "4" },
    });

    const { updatePlatformSearchAnalysisAction } = await import("./actions");

    await expect(
      updatePlatformSearchAnalysisAction(
        null,
        searchFormData({
          analysis: NORI_DEFINITION,
          analysis_locale: "en",
          intent: "replace",
        })
      )
    ).resolves.toMatchObject({ ok: true });
    expect(mockUpdatePlatformSearchSettings).toHaveBeenCalledWith(
      {
        engine: "opensearch",
        index: "publira-catalog",
        localeAnalyses: [
          { definition: NORI_DEFINITION, locale: "en", mode: "replace" },
        ],
        password: "",
        passwordUpdateMode: SEARCH_PASSWORD_UNCHANGED,
        url: "https://search.example.com",
        username: "publira",
      },
      3n,
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("platform:search-settings");
    expect(mockUpdateTag).toHaveBeenCalledWith("platform:audit-logs");
  });

  it("builds a language from the shared definition again whatever its editor holds", async () => {
    mockUpdatePlatformSearchSettings.mockResolvedValueOnce({
      ok: true,
      settings: { buildState: "building", revision: "4" },
    });

    const { updatePlatformSearchAnalysisAction } = await import("./actions");

    await updatePlatformSearchAnalysisAction(
      null,
      searchFormData({
        analysis: "not json",
        analysis_locale: "en",
        intent: "shared",
      })
    );

    const [input] = mockUpdatePlatformSearchSettings.mock.calls[0] ?? [];
    expect(input).toMatchObject({
      localeAnalyses: [{ locale: "en", mode: "shared" }],
    });
    expect(input).not.toHaveProperty("analysis");
  });

  // An Auditor is shown the same form, and the API refuses the save.
  it("reports a save the API refuses to the operator's role and clears nothing", async () => {
    mockUpdatePlatformSearchSettings.mockResolvedValueOnce({
      message:
        "You do not have permission to perform this action. Go back or use an account that does.",
      ok: false,
    });

    const { updatePlatformSearchAnalysisAction } = await import("./actions");

    await expect(
      updatePlatformSearchAnalysisAction(
        null,
        searchFormData({
          analysis: NORI_DEFINITION,
          analysis_locale: "en",
          intent: "replace",
        })
      )
    ).resolves.toEqual({
      message:
        "You do not have permission to perform this action. Go back or use an account that does.",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });

  it("refuses a definition that is not a JSON object without a round trip", async () => {
    const { updatePlatformSearchAnalysisAction } = await import("./actions");

    await expect(
      updatePlatformSearchAnalysisAction(
        null,
        searchFormData({ analysis: "[]", intent: "replace" })
      )
    ).resolves.toMatchObject({
      fieldErrors: {
        analysis:
          "Enter the definition as one JSON object, starting with { and ending with }.",
      },
      ok: false,
    });
    expect(mockGetPlatformSearchSettings).not.toHaveBeenCalled();
    expect(mockUpdatePlatformSearchSettings).not.toHaveBeenCalled();
  });

  // The engine and the credential are restated from the saved settings, so
  // they have to be the ones the editor was rendered beside.
  it("reports a conflict when the saved settings moved past the rendered revision", async () => {
    mockGetPlatformSearchSettings.mockResolvedValueOnce({
      ok: true,
      settings: { ...savedOpenSearch, revision: "5" },
    });

    const { updatePlatformSearchAnalysisAction } = await import("./actions");

    await expect(
      updatePlatformSearchAnalysisAction(
        null,
        searchFormData({ analysis: NORI_DEFINITION, intent: "replace" })
      )
    ).resolves.toEqual({
      message:
        "Another operator changed the search settings, so nothing was saved. Reload the screen and try again.",
      ok: false,
    });
    expect(mockUpdatePlatformSearchSettings).not.toHaveBeenCalled();
  });

  it("saves no analysis on PostgreSQL, which keeps no index", async () => {
    mockGetPlatformSearchSettings.mockResolvedValueOnce({
      ok: true,
      settings: {
        ...savedOpenSearch,
        engine: "sql",
        hasPassword: false,
        index: "",
        url: "",
        username: "",
      },
    });

    const { updatePlatformSearchAnalysisAction } = await import("./actions");

    await expect(
      updatePlatformSearchAnalysisAction(
        null,
        searchFormData({ analysis: NORI_DEFINITION, intent: "replace" })
      )
    ).resolves.toMatchObject({ ok: false });
    expect(mockUpdatePlatformSearchSettings).not.toHaveBeenCalled();
  });
});

describe("testPlatformSearchConnectionAction", () => {
  it("returns what the engine answered and clears the audit log, which records every test", async () => {
    const result = {
      failure:
        "The engine at this URL isn't the one selected above. Choose the engine it reports, or check the URL.",
      plugins: [],
      pluginsListed: true,
      product: "Elasticsearch",
      succeeded: false,
      version: "9.5.5",
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

  // Neither plugin decides the test, so a pass reads the same with or without
  // them.
  it.each([[["analysis-nori"]], [[]]])(
    "words a passing test (plugins %j)",
    async (plugins) => {
      mockTestPlatformSearchConnection.mockResolvedValueOnce({
        ok: true,
        result: {
          failure: "",
          plugins,
          pluginsListed: true,
          product: "OpenSearch",
          succeeded: true,
          version: "3.9.0",
        },
      });

      const { testPlatformSearchConnectionAction } = await import("./actions");

      await expect(
        testPlatformSearchConnectionAction(null, openSearchForm)
      ).resolves.toMatchObject({
        message: "The connection works.",
        ok: true,
      });
    }
  );
});
