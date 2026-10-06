import type { Locale } from "@publira/i18n";
import { z } from "zod";

import { optionalTrimmedString, revisionFormSchema } from "#lib/form-schemas";
import { getMessagesFor } from "#lib/messages";
import {
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
