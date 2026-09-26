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
  platformWebPushSettingsCacheTag,
  updatePlatformWebPushSubject,
} from "#lib/webpush-settings";

import { webPushFormFields, webPushFormSchema } from "./form-schemas";

export const updatePlatformWebPushSubjectAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getPlatformLocale();
  const schema = await webPushFormSchema(locale);
  const parsed = schema.safeParse(toFormDataInput(formData, webPushFormFields));
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const result = await withPlatformSessionReauth(() =>
    updatePlatformWebPushSubject(
      parsed.data.subject,
      parsed.data.revision,
      locale
    )
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(platformWebPushSettingsCacheTag);
  updateTag(platformAuditLogsCacheTag);

  const t = await getMessagesFor(locale);
  return { message: t("platform.webpush.saved"), ok: true };
};
