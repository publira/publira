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
  platformStorageSettingsCacheTag,
  testPlatformStorageConnection,
  updatePlatformStorageSettings,
} from "#lib/storage-settings";
import type {
  PlatformStorageCheckResult,
  PlatformStorageInput,
} from "#lib/storage-settings";

import { storageFormFields, storageFormSchema } from "./form-schemas";

/**
 * A test that ran carries its checks whichever way they went; one the API
 * refused to run carries only the message.
 */
export type PlatformStorageTestState = {
  checks?: PlatformStorageCheckResult[];
  message: string;
  ok: boolean;
} | null;

const toStorageInput = (
  data: PlatformStorageInput & { revision: bigint }
): PlatformStorageInput => ({
  accessKeyId: data.accessKeyId,
  bucket: data.bucket,
  endpoint: data.endpoint,
  forcePathStyle: data.forcePathStyle,
  publicBaseUrl: data.publicBaseUrl,
  region: data.region,
  secretAccessKey: data.secretAccessKey,
  secretAccessKeyUpdateMode: data.secretAccessKeyUpdateMode,
});

const parseStorageForm = async (formData: FormData) => {
  const locale = await getPlatformLocale();
  const schema = await storageFormSchema(locale);
  return {
    locale,
    parsed: schema.safeParse(toFormDataInput(formData, storageFormFields)),
  };
};

export const updatePlatformStorageSettingsAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const { locale, parsed } = await parseStorageForm(formData);
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const result = await withPlatformSessionReauth(() =>
    updatePlatformStorageSettings(
      toStorageInput(parsed.data),
      parsed.data.revision,
      locale
    )
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(platformStorageSettingsCacheTag);
  updateTag(platformAuditLogsCacheTag);

  const t = await getMessagesFor(locale);
  return { message: t("platform.storage.saved"), ok: true };
};

export const testPlatformStorageConnectionAction = async (
  _prevState: PlatformStorageTestState,
  formData: FormData
): Promise<PlatformStorageTestState> => {
  await assertSameOrigin();
  const { locale, parsed } = await parseStorageForm(formData);
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const result = await withPlatformSessionReauth(() =>
    testPlatformStorageConnection(toStorageInput(parsed.data), locale)
  );

  // The API records a failed test as well as a passing one.
  updateTag(platformAuditLogsCacheTag);

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  const t = await getMessagesFor(locale);
  return {
    checks: result.checks,
    message: result.succeeded
      ? t("platform.storage.test.succeeded")
      : t("platform.storage.test.failed_checks"),
    ok: result.succeeded,
  };
};
