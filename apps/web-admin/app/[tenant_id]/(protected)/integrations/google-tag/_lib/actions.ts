"use server";

import type { FormActionState } from "@publira/ui-components/action-form";
import { toFieldErrors } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";

import { getActionLocale } from "#lib/action-messages";
import { withAdminSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { getMessagesFor } from "#lib/messages";
import {
  tenantAnalyticsSettingsCacheTag,
  updateTenantAnalyticsSettings,
} from "#lib/tenant-analytics-settings";

import {
  googleTagFormFields,
  googleTagFormSchema,
} from "./google-tag-form-schemas";

export const updateGoogleTagAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    googleTagFormSchema(locale),
  ]);
  const parsed = schema.safeParse(
    toFormDataInput(formData, googleTagFormFields)
  );
  if (!parsed.success) {
    return {
      fieldErrors: toFieldErrors(parsed.error),
      message: t("errors.validation"),
      ok: false,
    };
  }

  const input = parsed.data;
  const result = await withAdminSessionReauth(() =>
    updateTenantAnalyticsSettings(input, locale)
  );
  if (!result.ok) {
    return {
      fieldErrors: result.fieldErrors,
      message: result.message,
      ok: false,
    };
  }

  // The storefront's read of the tag is revalidated by the API as the save
  // lands.
  updateTag(tenantAnalyticsSettingsCacheTag(input.tenantId));

  return {
    message: input.regenerateGatewayPath
      ? t("admin.settings.google_tag.gateway_path_regenerated")
      : t("admin.settings.google_tag.saved"),
    ok: true,
  };
};
