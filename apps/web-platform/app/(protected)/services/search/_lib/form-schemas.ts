import { parseLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { z } from "zod";

import { optionalTrimmedString, revisionFormSchema } from "#lib/form-schemas";
import { getMessagesFor } from "#lib/messages";
import {
  SEARCH_ANALYSIS_MAX_BYTES,
  SEARCH_PASSWORD_CLEAR,
  SEARCH_PASSWORD_REPLACE,
  SEARCH_PASSWORD_UNCHANGED,
  searchEngines,
} from "#lib/search-settings-shared";

/** Mirrors `platformsearch.Validate`: http(s) with a host and no userinfo. */
const isEngineUrl = (value: string): boolean => {
  if (!URL.canParse(value)) {
    return false;
  }
  const url = new URL(value);
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    url.host !== "" &&
    url.username === "" &&
    url.password === ""
  );
};

const INDEX_FORBIDDEN_RE = /[A-Z\s"*\\<|,>/?#:]/u;

/**
 * Mirrors `platformsearch.validIndex`, the rules both engines name an index
 * or an alias by. Empty is left to the server, which takes the default alias.
 */
const isIndexAlias = (value: string): boolean =>
  !value ||
  (value !== "." &&
    value !== ".." &&
    value.length <= 200 &&
    !/^[-_+]/u.test(value) &&
    !INDEX_FORBIDDEN_RE.test(value));

export const searchFormFields = {
  credentialMode: { kind: "value", name: "credential_mode" },
  engine: "value",
  index: "value",
  password: "value",
  passwordUpdateMode: { kind: "value", name: "password_update_mode" },
  revision: "value",
  url: "value",
  username: "value",
} as const;

/**
 * The search form as the API takes it. The SQL engine connects to nothing, so
 * it sends no URL, alias, or credential. On another engine the credential is
 * one choice: no authentication clears the stored pair, and a username either
 * keeps the stored password or states a new one.
 */
export const searchFormSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z
    .object({
      credentialMode: z.preprocess(
        (value) => (value === "basic" ? "basic" : "none"),
        z.enum(["basic", "none"])
      ),
      engine: z.enum(searchEngines, {
        error: t("platform.search.form.engine_required"),
      }),
      index: optionalTrimmedString(200),
      password: z.preprocess(
        (value) => (typeof value === "string" ? value.trim() : ""),
        z.string()
      ),
      passwordUpdateMode: z.preprocess(
        (value) =>
          value === String(SEARCH_PASSWORD_REPLACE)
            ? SEARCH_PASSWORD_REPLACE
            : SEARCH_PASSWORD_UNCHANGED,
        z.number()
      ),
      revision: revisionFormSchema(t("platform.policy.revision_invalid")),
      url: optionalTrimmedString(2048),
      username: optionalTrimmedString(255),
    })
    .superRefine((value, ctx) => {
      if (value.engine === "sql") {
        return;
      }
      if (!value.url) {
        ctx.addIssue({
          code: "custom",
          message: t("platform.search.form.url_required"),
          path: ["url"],
        });
      } else if (!isEngineUrl(value.url)) {
        ctx.addIssue({
          code: "custom",
          message: t("platform.search.form.url_invalid"),
          path: ["url"],
        });
      }
      if (!isIndexAlias(value.index)) {
        ctx.addIssue({
          code: "custom",
          message: t("platform.search.form.index_invalid"),
          path: ["index"],
        });
      }
      if (value.credentialMode !== "basic") {
        return;
      }
      if (!value.username) {
        ctx.addIssue({
          code: "custom",
          message: t("platform.search.form.username_required"),
          path: ["username"],
        });
      }
      if (
        value.passwordUpdateMode === SEARCH_PASSWORD_REPLACE &&
        !value.password
      ) {
        ctx.addIssue({
          code: "custom",
          message: t("platform.search.form.password_required"),
          path: ["password"],
        });
      }
      if (isEngineUrl(value.url) && new URL(value.url).protocol !== "https:") {
        ctx.addIssue({
          code: "custom",
          message: t("platform.search.form.credentials_need_https"),
          path: ["url"],
        });
      }
    })
    .transform(({ credentialMode, ...value }) => {
      if (value.engine === "sql") {
        return {
          ...value,
          index: "",
          password: "",
          passwordUpdateMode: SEARCH_PASSWORD_CLEAR,
          url: "",
          username: "",
        };
      }
      if (credentialMode === "none") {
        return {
          ...value,
          password: "",
          passwordUpdateMode: SEARCH_PASSWORD_CLEAR,
          username: "",
        };
      }
      return {
        ...value,
        password:
          value.passwordUpdateMode === SEARCH_PASSWORD_REPLACE
            ? value.password
            : "",
      };
    });
};

export const searchAnalysisFormFields = {
  analysis: "value",
  analysisLocale: { kind: "value", name: "analysis_locale" },
  intent: "value",
  revision: "value",
} as const;

/** Whether `value` parses as one JSON object, which is all a definition can be. */
const isJsonObject = (value: string): boolean => {
  try {
    const parsed: unknown = JSON.parse(value);
    return (
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    );
  } catch {
    return false;
  }
};

const WHITESPACE_RE = /\s/u;

/**
 * `json` with the whitespace between its tokens taken out, which is the
 * layout the editor adds to a definition the server answers compacted. A
 * definition the server accepted therefore fits its size limit again
 * whatever the editor's indentation added. Only valid JSON is passed in:
 * outside one, taking a space out could join two values into one.
 */
const compactJson = (json: string): string => {
  let out = "";
  let inString = false;
  let escaped = false;

  for (const char of json) {
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      out += char;
    } else if (char === '"') {
      inString = true;
      out += char;
    } else if (!WHITESPACE_RE.test(char)) {
      out += char;
    }
  }
  return out;
};

/**
 * The text analysis form, for the shared definition or, with `analysisLocale`,
 * one language's own: save the definition the editor holds, or reset, which
 * ignores the editor. The shared definition resets to the default, and a
 * language's own to the shared one. What the definition has to define, and
 * whether the engine builds an index from it, is the server's to check; this
 * catches only what needs no engine to tell. A definition to save is sent
 * compacted, and its size is measured that way.
 */
export const searchAnalysisFormSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z
    .object({
      analysis: z.preprocess(
        (value) => (typeof value === "string" ? value.trim() : ""),
        z.string()
      ),
      // Empty is the shared definition.
      analysisLocale: z.preprocess(
        (value) => (value === "" || value === undefined ? undefined : value),
        z
          .string()
          .transform((value, ctx) => {
            const code = parseLocale(value);
            if (!code) {
              ctx.addIssue({
                code: "custom",
                message: t("platform.search.analysis.locale_invalid"),
              });
              return z.NEVER;
            }
            return code;
          })
          .optional()
      ),
      intent: z.enum(["replace", "default", "shared"], {
        error: t("platform.search.analysis.intent_invalid"),
      }),
      revision: revisionFormSchema(t("platform.policy.revision_invalid")),
    })
    .transform((value, ctx) => {
      // The default replaces the shared definition, and the shared one
      // replaces a language's own.
      if (
        (value.intent === "default" && value.analysisLocale) ||
        (value.intent === "shared" && !value.analysisLocale)
      ) {
        ctx.addIssue({
          code: "custom",
          message: t("platform.search.analysis.intent_invalid"),
          path: ["intent"],
        });
        return z.NEVER;
      }
      if (value.intent !== "replace") {
        return value;
      }
      if (!value.analysis) {
        ctx.addIssue({
          code: "custom",
          message: value.analysisLocale
            ? t("platform.search.analysis.locale_required")
            : t("platform.search.analysis.required"),
          path: ["analysis"],
        });
        return z.NEVER;
      }
      if (!isJsonObject(value.analysis)) {
        ctx.addIssue({
          code: "custom",
          message: t("platform.search.analysis.not_object"),
          path: ["analysis"],
        });
        return z.NEVER;
      }
      const analysis = compactJson(value.analysis);
      if (
        new TextEncoder().encode(analysis).length > SEARCH_ANALYSIS_MAX_BYTES
      ) {
        ctx.addIssue({
          code: "custom",
          message: t("platform.search.analysis.too_large"),
          path: ["analysis"],
        });
        return z.NEVER;
      }
      return { ...value, analysis };
    });
};
