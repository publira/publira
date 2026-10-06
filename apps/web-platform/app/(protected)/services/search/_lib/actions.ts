"use server";

import type { FormActionState } from "@publira/ui-components/action-form";
import { toFieldErrors, toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";

import { platformAuditLogsCacheTag } from "#lib/audit-logs";
import { withPlatformSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { getPlatformLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import {
  getPlatformSearchSettings,
  platformSearchSettingsCacheTag,
  testPlatformSearchConnection,
  updatePlatformSearchSettings,
} from "#lib/search-settings";
import type {
  PlatformSearchInput,
  PlatformSearchTestResult,
} from "#lib/search-settings";
import { SEARCH_PASSWORD_UNCHANGED } from "#lib/search-settings-shared";

import {
  searchAnalysisFormFields,
  searchAnalysisFormSchema,
  searchFormFields,
  searchFormSchema,
} from "./form-schemas";

/**
 * A test that ran carries what the engine answered whichever way it went; one
 * the API refused to run carries only the message.
 */
export type PlatformSearchTestState = {
  message: string;
  ok: boolean;
  result?: PlatformSearchTestResult;
} | null;

const toSearchInput = (
  data: PlatformSearchInput & { revision: bigint }
): PlatformSearchInput => ({
  engine: data.engine,
  index: data.index,
  password: data.password,
  passwordUpdateMode: data.passwordUpdateMode,
  url: data.url,
  username: data.username,
});

const parseSearchForm = async (formData: FormData) => {
  const locale = await getPlatformLocale();
  const schema = await searchFormSchema(locale);
  return {
    locale,
    parsed: schema.safeParse(toFormDataInput(formData, searchFormFields)),
  };
};

export const updatePlatformSearchSettingsAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const { locale, parsed } = await parseSearchForm(formData);
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const result = await withPlatformSessionReauth(() =>
    updatePlatformSearchSettings(
      toSearchInput(parsed.data),
      parsed.data.revision,
      locale
    )
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(platformSearchSettingsCacheTag);
  updateTag(platformAuditLogsCacheTag);

  const t = await getMessagesFor(locale);
  return {
    message:
      result.settings.buildState === "building"
        ? t("platform.search.saved_building")
        : t("platform.search.saved"),
    ok: true,
  };
};

/**
 * Save the text analysis the editor holds, or go back to the default. The
 * engine, URL, alias, and credential are sent again as they are saved, read
 * at the revision the screen was rendered at, so this form changes the
 * analysis and nothing else.
 */
export const updatePlatformSearchAnalysisAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getPlatformLocale();
  const [schema, t] = await Promise.all([
    searchAnalysisFormSchema(locale),
    getMessagesFor(locale),
  ]);
  const parsed = schema.safeParse(
    toFormDataInput(formData, searchAnalysisFormFields)
  );
  if (!parsed.success) {
    return {
      fieldErrors: toFieldErrors(parsed.error),
      message: toFormErrorMessage(parsed.error, { locale }),
      ok: false,
    };
  }

  const current = await getPlatformSearchSettings();
  if (!current.ok) {
    return { message: current.message, ok: false };
  }
  // The saved values are the ones the request restates, so they have to be
  // the ones the editor was rendered beside: a newer save would otherwise be
  // restated under the old revision, which the API refuses anyway.
  if (current.settings.revision !== String(parsed.data.revision)) {
    return { message: t("platform.search.save_conflict"), ok: false };
  }
  if (current.settings.engine === "sql") {
    return { message: t("platform.search.analysis.sql_engine"), ok: false };
  }

  const { settings } = current;
  const result = await withPlatformSessionReauth(() =>
    updatePlatformSearchSettings(
      {
        analysis:
          parsed.data.intent === "default"
            ? { mode: "default" }
            : { definition: parsed.data.analysis, mode: "replace" },
        engine: settings.engine,
        index: settings.index,
        password: "",
        passwordUpdateMode: SEARCH_PASSWORD_UNCHANGED,
        url: settings.url,
        username: settings.username,
      },
      parsed.data.revision,
      locale
    )
  );
  if (!result.ok) {
    // The reason sits next to the editor; the form's own message says only
    // that nothing was saved, rather than repeating it.
    return result.fieldErrors?.analysis
      ? {
          fieldErrors: result.fieldErrors,
          message: t("platform.search.analysis.refused"),
          ok: false,
        }
      : { message: result.message, ok: false };
  }

  updateTag(platformSearchSettingsCacheTag);
  updateTag(platformAuditLogsCacheTag);

  return {
    message:
      result.settings.buildState === "building"
        ? t("platform.search.analysis.saved_building")
        : t("platform.search.analysis.saved"),
    ok: true,
  };
};

export const testPlatformSearchConnectionAction = async (
  _prevState: PlatformSearchTestState,
  formData: FormData
): Promise<PlatformSearchTestState> => {
  await assertSameOrigin();
  const { locale, parsed } = await parseSearchForm(formData);
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const result = await withPlatformSessionReauth(() =>
    testPlatformSearchConnection(toSearchInput(parsed.data), locale)
  );

  // The API records a failed test as well as a passing one.
  updateTag(platformAuditLogsCacheTag);

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  const t = await getMessagesFor(locale);
  const { icuInstalled, kuromojiInstalled, succeeded } = result.result;
  let message = result.result.failure;
  if (succeeded) {
    // The API asks for both plugins only while the default analysis is saved,
    // so a test passing without them was run beside a saved definition that
    // does not use them.
    message =
      kuromojiInstalled && icuInstalled
        ? t("platform.search.test.succeeded")
        : t("platform.search.test.succeeded_saved_analysis");
  }
  return { message, ok: succeeded, result: result.result };
};
