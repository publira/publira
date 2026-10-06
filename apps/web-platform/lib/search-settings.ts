import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorHasFieldViolation,
  rpcErrorRawMessage,
} from "@publira/api-client/errors";
import type {
  PlatformSearchBuildFailure,
  PlatformSearchServing as RawPlatformSearchServingMessage,
  PlatformSearchSettings as RawPlatformSearchSettingsMessage,
  TestPlatformSearchConnectionResponse,
} from "@publira/api-client/platform/types";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { cacheLife, cacheTag } from "next/cache";

import {
  SHARED_READ_CACHE_LIFE,
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
  withServiceHeaders,
} from "./api-client";
import { verifyPlatformSession } from "./auth-session";
import { rethrowUnauthenticatedRpcError } from "./auth-shared";
import { getPlatformLocale } from "./locale";
import type { PlatformMessageKey } from "./locale";
import { getMessagesFor } from "./messages";
import {
  SEARCH_PLUGIN_ICU,
  SEARCH_PLUGIN_KUROMOJI,
} from "./search-settings-shared";
import type {
  PlatformSearchBuildState,
  PlatformSearchEngine,
  PlatformSearchServing,
  PlatformSearchSettings,
} from "./search-settings-shared";

export type { PlatformSearchSettings } from "./search-settings-shared";

/**
 * What a save does to the text analysis: saves `definition`, or goes back to
 * the default. A save that states none keeps the saved one.
 */
export type PlatformSearchAnalysisInput =
  | { definition: string; mode: "replace" }
  | { mode: "default" };

/** What a save states: the values the form holds. */
export interface PlatformSearchInput {
  analysis?: PlatformSearchAnalysisInput;
  engine: PlatformSearchEngine;
  index: string;
  password: string;
  passwordUpdateMode: number;
  url: string;
  username: string;
}

export type GetPlatformSearchSettingsResult =
  | { ok: true; settings: PlatformSearchSettings }
  | { message: string; ok: false };

export type UpdatePlatformSearchSettingsResult =
  | { ok: true; settings: PlatformSearchSettings }
  | {
      /**
       * The engine's or the server's reason for refusing the text analysis,
       * set when the refusal names that field.
       */
      fieldErrors?: { analysis?: string };
      message: string;
      ok: false;
    };

/** What the engine answered to a connection test, worded for the screen. */
export interface PlatformSearchTestResult {
  /** Why the test failed, empty when it passed. */
  failure: string;
  icuInstalled: boolean;
  kuromojiInstalled: boolean;
  /** The product the engine reported, empty when it did not answer. */
  product: string;
  succeeded: boolean;
  version: string;
}

export type TestPlatformSearchConnectionResult =
  | { ok: true; result: PlatformSearchTestResult }
  | { message: string; ok: false };

/** The tag the search settings read is filed under, and their save clears. */
export const platformSearchSettingsCacheTag = "platform:search-settings";

/**
 * The generated enum numbers `PlatformSearchEngine`. Zero is a message that
 * named no engine, which is what the server answers for none saved: the SQL
 * engine.
 */
const engineNumbers = {
  elasticsearch: 3,
  opensearch: 2,
  sql: 1,
} as const satisfies Record<PlatformSearchEngine, number>;

const toEngine = (value: number | undefined): PlatformSearchEngine => {
  switch (value) {
    case engineNumbers.opensearch: {
      return "opensearch";
    }
    case engineNumbers.elasticsearch: {
      return "elasticsearch";
    }
    default: {
      return "sql";
    }
  }
};

export const toEngineNumber = (engine: PlatformSearchEngine): number =>
  engineNumbers[engine];

/** The generated enum numbers `PlatformSearchAnalysisUpdateMode`. */
const analysisModeNumbers = {
  default: 3,
  replace: 2,
} as const satisfies Record<PlatformSearchAnalysisInput["mode"], number>;

/** The update request's analysis fields; none keeps the saved definition. */
const toAnalysisRequest = (analysis?: PlatformSearchAnalysisInput) => {
  if (!analysis) {
    return {};
  }
  return {
    analysis: analysis.mode === "replace" ? analysis.definition : "",
    analysisUpdateMode: analysisModeNumbers[analysis.mode],
  };
};

const WHITESPACE_RE = /\s/u;

/**
 * `json` laid out two spaces to a level, for the definition to be read and
 * edited. The server answers it compacted. Only the whitespace between tokens
 * changes, so every number keeps the spelling it was saved with, which a
 * round trip through `JSON.parse` would not promise for a large integer.
 */
const indentJson = (json: string): string => {
  let out = "";
  let depth = 0;
  let inString = false;
  let escaped = false;
  const newline = () => `\n${"  ".repeat(depth)}`;

  for (const [index, char] of [...json].entries()) {
    if (inString) {
      out += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    switch (char) {
      case '"': {
        inString = true;
        out += char;
        break;
      }
      case "{":
      case "[": {
        const close = char === "{" ? "}" : "]";
        // An empty object or array stays on one line.
        if (
          json
            .slice(index + 1)
            .trimStart()
            .startsWith(close)
        ) {
          out += char;
        } else {
          depth += 1;
          out += char + newline();
        }
        break;
      }
      case "}":
      case "]": {
        if (out.endsWith("{") || out.endsWith("[")) {
          out += char;
        } else {
          depth -= 1;
          out += newline() + char;
        }
        break;
      }
      case ",": {
        out += char + newline();
        break;
      }
      case ":": {
        out += ": ";
        break;
      }
      default: {
        if (!WHITESPACE_RE.test(char)) {
          out += char;
        }
      }
    }
  }
  return out;
};
/** The generated enum numbers `PlatformSearchBuildState`. */
const toBuildState = (value: number | undefined): PlatformSearchBuildState => {
  switch (value) {
    case 2: {
      return "building";
    }
    case 3: {
      return "failed";
    }
    default: {
      return "serving";
    }
  }
};

type RawPlatformSearchServing = Pick<
  RawPlatformSearchServingMessage,
  "engine" | "index" | "revision" | "since" | "url"
>;

type RawPlatformSearchSettings = Pick<
  RawPlatformSearchSettingsMessage,
  | "analysis"
  | "buildState"
  | "defaultAnalysis"
  | "engine"
  | "hasPassword"
  | "index"
  | "revision"
  | "url"
  | "username"
> & {
  buildFailure?: Pick<PlatformSearchBuildFailure, "error" | "failedAt">;
  serving?: RawPlatformSearchServing;
};

const toServing = (
  serving?: RawPlatformSearchServing
): PlatformSearchServing => ({
  engine: toEngine(serving?.engine),
  index: serving?.index ?? "",
  revision: String(serving?.revision ?? 0),
  since: serving?.since ?? "",
  url: serving?.url ?? "",
});

const toBuildFailure = (
  failure?: Pick<PlatformSearchBuildFailure, "error" | "failedAt">
): PlatformSearchSettings["buildFailure"] => ({
  error: failure?.error ?? "",
  failedAt: failure?.failedAt ?? "",
});

export const toPlatformSearchSettings = (
  settings?: RawPlatformSearchSettings
): PlatformSearchSettings => {
  const buildState = toBuildState(settings?.buildState);
  return {
    analysis: indentJson(settings?.analysis ?? ""),
    buildFailure:
      buildState === "failed" ? toBuildFailure(settings?.buildFailure) : null,
    buildState,
    defaultAnalysis: settings?.defaultAnalysis ?? false,
    engine: toEngine(settings?.engine),
    hasPassword: settings?.hasPassword ?? false,
    index: settings?.index ?? "",
    revision: String(settings?.revision ?? 0),
    serving: toServing(settings?.serving),
    url: settings?.url ?? "",
    username: settings?.username ?? "",
  };
};

/**
 * The message for a `SEARCH_TEST_*` reason, which the connection test answers
 * with and the audit log records. Anything else is not a reason this console
 * knows, and answers `undefined`.
 */
export const searchTestFailureMessage = async (
  reason: string,
  locale: Locale
): Promise<string | undefined> => {
  const t = await getMessagesFor(locale);

  switch (reason) {
    case "SEARCH_TEST_NOT_A_SEARCH_ENGINE": {
      return t("platform.search.test.reasons.not_a_search_engine");
    }
    case "SEARCH_TEST_PLUGIN_MISSING": {
      return t("platform.search.test.reasons.plugin_missing");
    }
    case "SEARCH_TEST_UNAUTHORIZED": {
      return t("platform.search.test.reasons.unauthorized");
    }
    case "SEARCH_TEST_UNREACHABLE": {
      return t("platform.search.test.reasons.unreachable");
    }
    case "SEARCH_TEST_WRONG_PRODUCT": {
      return t("platform.search.test.reasons.wrong_product");
    }
    default: {
      return undefined;
    }
  }
};

const toTestResult = async (
  response: Pick<
    TestPlatformSearchConnectionResponse,
    | "analysisIcuInstalled"
    | "analysisKuromojiInstalled"
    | "product"
    | "reason"
    | "succeeded"
    | "version"
  >,
  locale: Locale
): Promise<PlatformSearchTestResult> => {
  const result = {
    icuInstalled: response.analysisIcuInstalled,
    kuromojiInstalled: response.analysisKuromojiInstalled,
    product: response.product,
    succeeded: response.succeeded,
    version: response.version,
  };
  if (response.succeeded) {
    return { ...result, failure: "" };
  }

  const t = await getMessagesFor(locale);
  // The engine answered and lacks a plugin: name the ones it lacks, which is
  // what the operator installs before testing again.
  if (response.reason === "SEARCH_TEST_PLUGIN_MISSING") {
    const missing = [
      ...(response.analysisKuromojiInstalled ? [] : [SEARCH_PLUGIN_KUROMOJI]),
      ...(response.analysisIcuInstalled ? [] : [SEARCH_PLUGIN_ICU]),
    ];
    if (missing.length > 0) {
      return {
        ...result,
        failure: t("platform.search.test.missing_plugins", {
          plugins: missing.join(", "),
        }),
      };
    }
  }
  return {
    ...result,
    failure:
      (await searchTestFailureMessage(response.reason, locale)) ??
      t("platform.search.test.reasons.unknown"),
  };
};

/**
 * The server's validation text names the field it refused and nothing else —
 * never a credential, and never the URL, which may carry one — so it passes
 * through as the actionable detail. Other categories take the shared copy.
 *
 * A refused text analysis is that detail too: the engine's own reason for not
 * building an index from the definition, which is what the operator edits the
 * definition by, so it is also handed back as the analysis field's error.
 */
const writeFailure = async (
  error: unknown,
  locale: Locale,
  fallbackKey: PlatformMessageKey
): Promise<{
  fieldErrors?: { analysis?: string };
  message: string;
  ok: false;
}> => {
  rethrowUnauthenticatedRpcError(error);
  rethrowUnclassifiedRpcError(error);
  const t = await getMessagesFor(locale);
  const fallback = t(fallbackKey);
  const detail = rpcErrorRawMessage(error)?.trim();
  return {
    ...(detail && rpcErrorHasFieldViolation(error, "analysis")
      ? { fieldErrors: { analysis: detail } }
      : {}),
    message: rpcErrorMessage(error, fallback, {
      locale,
      overrides: {
        "invalid-argument": detail || fallback,
        precondition: t("platform.search.save_conflict"),
      },
    }),
    ok: false,
  };
};

const getPlatformSearchSettingsForLocale = async (
  locale: Locale
): Promise<GetPlatformSearchSettingsResult> => {
  "use cache";
  cacheTag(platformSearchSettingsCacheTag);

  try {
    const response = await apiClient.searchSettings.getPlatformSearchSettings(
      {},
      withServiceHeaders()
    );
    const settings = toPlatformSearchSettings(response.settings);
    // The worker finishes a build without a write through this console, and
    // retries a failed one on its next pass, so while either is pending the
    // entry is kept no longer than the screen's own refresh asks it again.
    if (settings.buildState === "serving") {
      cacheLife(SHARED_READ_CACHE_LIFE);
    } else {
      cacheLife("seconds");
    }
    return { ok: true, settings };
  } catch (error) {
    // A `"use cache"` scope cannot rethrow: the fill would fail the whole
    // request. The entry is dropped instead, so the settings come back as
    // soon as the API does.
    dropFailedCacheEntry();
    const t = await getMessagesFor(locale);
    return {
      message: rpcErrorMessage(error, t("platform.search.load_failed"), {
        locale,
      }),
      ok: false,
    };
  }
};

/**
 * The search settings, for their screen and the setup checklist, together
 * with the configuration the search answers from and where a build of the
 * saved one stands. The password never leaves the API: the answer says only
 * whether one is set.
 *
 * Read with the service credential: the settings are the same for every
 * operator, so one entry serves all of them.
 */
export const getPlatformSearchSettings =
  async (): Promise<GetPlatformSearchSettingsResult> => {
    await verifyPlatformSession();
    return getPlatformSearchSettingsForLocale(await getPlatformLocale());
  };

/**
 * Save the search settings. `expectedRevision` is the revision the screen was
 * rendered at, so a save based on values another operator has since replaced
 * is refused instead of rolling their change back. The text analysis is kept
 * unless `input.analysis` states it.
 */
export const updatePlatformSearchSettings = async (
  input: PlatformSearchInput,
  expectedRevision: bigint,
  locale: Locale
): Promise<UpdatePlatformSearchSettingsResult> => {
  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    const t = await getMessagesFor(locale);
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response =
      await apiClient.searchSettings.updatePlatformSearchSettings(
        {
          ...toAnalysisRequest(input.analysis),
          engine: toEngineNumber(input.engine),
          expectedRevision,
          index: input.index,
          password: input.password,
          passwordUpdateMode: input.passwordUpdateMode,
          url: input.url,
          username: input.username,
        },
        buildSessionHeaders(sessionId)
      );
    return { ok: true, settings: toPlatformSearchSettings(response.settings) };
  } catch (error) {
    return writeFailure(error, locale, "platform.search.save_failed");
  }
};

/**
 * Ask the engine the form names what it is, with the password the form states
 * or the stored one. The test saves nothing.
 */
export const testPlatformSearchConnection = async (
  input: PlatformSearchInput,
  locale: Locale
): Promise<TestPlatformSearchConnectionResult> => {
  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    const t = await getMessagesFor(locale);
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response =
      await apiClient.searchSettings.testPlatformSearchConnection(
        {
          engine: toEngineNumber(input.engine),
          password: input.password,
          passwordUpdateMode: input.passwordUpdateMode,
          url: input.url,
          username: input.username,
        },
        buildSessionHeaders(sessionId)
      );
    return { ok: true, result: await toTestResult(response, locale) };
  } catch (error) {
    return writeFailure(error, locale, "platform.search.test.failed");
  }
};
