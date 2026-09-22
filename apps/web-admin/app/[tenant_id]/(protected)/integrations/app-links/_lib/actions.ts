"use server";

import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";

import type { FormActionState } from "#components/action-form";
import { getActionLocale } from "#lib/action-messages";
import { withAdminSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { getMessagesFor } from "#lib/messages";
import {
  tenantMobileAppAssociationCacheTag,
  updateTenantMobileAppAssociation,
} from "#lib/tenant-mobile-app-association";

import {
  appLinksFormFields,
  appLinksFormSchema,
} from "./app-links-form-schemas";

export const updateAppLinksAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    appLinksFormSchema(locale),
  ]);
  const parsed = schema.safeParse(
    toFormDataInput(formData, appLinksFormFields)
  );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const { association, tenantId } = parsed.data;
  const result = await withAdminSessionReauth(() =>
    updateTenantMobileAppAssociation({ association, tenantId }, locale)
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(tenantMobileAppAssociationCacheTag(tenantId));

  return { message: t("admin.settings.app_links.saved"), ok: true };
};
