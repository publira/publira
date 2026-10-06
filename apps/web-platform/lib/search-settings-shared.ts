/**
 * How the stored password is treated by a save or a test, matching
 * `publira.platform.v1.SecretUpdateMode`.
 */
export const SEARCH_PASSWORD_UNCHANGED = 1;
export const SEARCH_PASSWORD_REPLACE = 2;
export const SEARCH_PASSWORD_CLEAR = 3;

/** The engines a save accepts, in the order the form offers them. */
export const searchEngines = ["sql", "opensearch", "elasticsearch"] as const;

export type PlatformSearchEngine = (typeof searchEngines)[number];

export const isSearchEngine = (value: unknown): value is PlatformSearchEngine =>
  searchEngines.some((engine) => engine === value);

/**
 * The product each engine is, as the screen names it. A product name reads the
 * same in every language, so it is not catalog copy, the way a language's
 * autonym is not.
 */
export const searchEngineName = (engine: PlatformSearchEngine): string => {
  switch (engine) {
    case "elasticsearch": {
      return "Elasticsearch";
    }
    case "opensearch": {
      return "OpenSearch";
    }
    default: {
      return "PostgreSQL";
    }
  }
};

/**
 * Where the saved settings stand against the ones the search answers from:
 * answering, waiting on the worker to build their index, or left behind by a
 * build that failed.
 */
export type PlatformSearchBuildState = "building" | "failed" | "serving";

/** How the engine is signed in to: not at all, or with HTTP basic auth. */
export type SearchCredentialMode = "basic" | "none";

/** The configuration the search answers from right now. */
export interface PlatformSearchServing {
  engine: PlatformSearchEngine;
  index: string;
  /** Decimal int64; `"0"` is the SQL engine of an install that never moved. */
  revision: string;
  /** RFC 3339; empty at revision zero. */
  since: string;
  url: string;
}

export interface PlatformSearchSettings {
  /**
   * The `settings.analysis` the catalog index is built with, as indented JSON:
   * the saved definition, or the default when none is saved. Empty on the SQL
   * engine, which has no index.
   */
  analysis: string;
  /** Set while `buildState` is `failed`, and only then. */
  buildFailure: { error: string; failedAt: string } | null;
  buildState: PlatformSearchBuildState;
  /** Whether `analysis` is the default rather than a saved definition. */
  defaultAnalysis: boolean;
  engine: PlatformSearchEngine;
  hasPassword: boolean;
  /** Empty on the SQL engine. */
  index: string;
  /** Decimal int64; `"0"` means no configuration has been saved yet. */
  revision: string;
  serving: PlatformSearchServing;
  /** Empty on the SQL engine. */
  url: string;
  username: string;
}

/**
 * Whether the saved settings name the engine, URL, and alias the search
 * answers from, so that a build of them is a new index for the same target:
 * the one a changed text analysis starts.
 */
export const isSameSearchTarget = (
  settings: Pick<PlatformSearchSettings, "engine" | "index" | "serving" | "url">
): boolean =>
  settings.engine === settings.serving.engine &&
  settings.url === settings.serving.url &&
  settings.index === settings.serving.index;

/**
 * The largest definition a save takes, in UTF-8 bytes, matching
 * `opensearchbackend.MaxAnalysisBytes`.
 */
export const SEARCH_ANALYSIS_MAX_BYTES = 64 * 1024;

export const searchCredentialMode = (
  settings: Pick<PlatformSearchSettings, "username">
): SearchCredentialMode => (settings.username ? "basic" : "none");

/**
 * The analysis plugins the catalog index is built with, which every engine but
 * SQL has to have on every node.
 */
export const SEARCH_PLUGIN_KUROMOJI = "analysis-kuromoji";
export const SEARCH_PLUGIN_ICU = "analysis-icu";
