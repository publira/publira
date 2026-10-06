"use server";

import type { FormActionState } from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";

import { platformAuditLogsCacheTag } from "#lib/audit-logs";
import { withPlatformSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { getPlatformLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import {
  platformSearchSettingsCacheTag,
  testPlatformSearchConnection,
  updatePlatformSearchSettings,
} from "#lib/search-settings";
import type {
  PlatformSearchInput,
  PlatformSearchTestResult,
} from "#lib/search-settings";

import { searchFormFields, searchFormSchema } from "./form-schemas";

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
  return {
    message: result.result.succeeded
      ? t("platform.search.test.succeeded")
      : result.result.failure,
    ok: result.result.succeeded,
    result: result.result,
  };
};
