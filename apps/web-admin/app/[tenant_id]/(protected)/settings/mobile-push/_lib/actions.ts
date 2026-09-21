"use server";

import type { FormActionState } from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";

import { getActionLocale } from "#lib/action-messages";
import { withAdminSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import {
  deleteTenantFcmCredentials,
  saveTenantFcmCredentials,
  tenantFcmSettingsCacheTag,
} from "#lib/fcm-settings";
import { getMessagesFor } from "#lib/messages";

import {
  checkServiceAccountKey,
  fcmCredentialsFormFields,
  fcmCredentialsFormSchema,
  fcmDeleteFormSchema,
} from "./fcm-form-schemas";

export const saveFcmCredentialsAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    fcmCredentialsFormSchema(locale),
  ]);
  const parsed = schema.safeParse(
    toFormDataInput(formData, fcmCredentialsFormFields)
  );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const { projectId, serviceAccountFile, tenantId } = parsed.data;
  const serviceAccountJson = await serviceAccountFile.text();
  const problem = checkServiceAccountKey(serviceAccountJson, projectId);
  if (problem?.kind === "not-json") {
    return {
      message: t("admin.settings.mobile_push.validation.not_json"),
      ok: false,
    };
  }
  if (problem?.kind === "not-service-account") {
    return {
      message: t("admin.settings.mobile_push.validation.not_service_account"),
      ok: false,
    };
  }
  if (problem?.kind === "project-mismatch") {
    return {
      message: t("admin.settings.mobile_push.validation.project_mismatch", {
        entered: projectId,
        key: problem.keyProjectId,
      }),
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
    saveTenantFcmCredentials(
      { projectId, serviceAccountJson, tenantId },
      locale
    )
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(tenantFcmSettingsCacheTag(tenantId));

  return { message: t("admin.settings.mobile_push.saved"), ok: true };
};

export const deleteFcmCredentialsAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    fcmDeleteFormSchema(locale),
  ]);
  const parsed = schema.safeParse(
    toFormDataInput(formData, fcmCredentialsFormFields)
  );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const { tenantId } = parsed.data;
  const result = await withAdminSessionReauth(() =>
    deleteTenantFcmCredentials(tenantId, locale)
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(tenantFcmSettingsCacheTag(tenantId));

  return { message: t("admin.settings.mobile_push.deleted"), ok: true };
};
