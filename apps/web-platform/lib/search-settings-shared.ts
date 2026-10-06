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
  /** Set while `buildState` is `failed`, and only then. */
  buildFailure: { error: string; failedAt: string } | null;
  buildState: PlatformSearchBuildState;
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

export const searchCredentialMode = (
  settings: Pick<PlatformSearchSettings, "username">
): SearchCredentialMode => (settings.username ? "basic" : "none");

/**
 * The analysis plugins the catalog index is built with, which every engine but
 * SQL has to have on every node.
 */
export const SEARCH_PLUGIN_KUROMOJI = "analysis-kuromoji";
export const SEARCH_PLUGIN_ICU = "analysis-icu";
