"use server";

import type { FormActionState } from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";

import { getActionLocale } from "#lib/action-messages";
import { withAdminSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { getMessagesFor } from "#lib/messages";
import {
  tenantCommunityLimitsCacheTag,
  updateTenantCommunityLimitSettings,
} from "#lib/tenant-community-limits";
import {
  tenantRetentionSettingsCacheTag,
  updateTenantRetentionSettings,
} from "#lib/tenant-retention-settings";

import {
  communityLimitsFormFields,
  communityLimitsFormSchema,
  retentionSettingsFormFields,
  retentionSettingsFormSchema,
} from "./policy-form-schemas";

export const updateTenantCommunityLimitsAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const t = await getMessagesFor(locale);
  const tenantId = String(formData.get("tenant_id") ?? "").trim();
  if (!tenantId) {
    return { message: t("admin.settings.tenant_missing"), ok: false };
  }

  const schema = await communityLimitsFormSchema(locale);
  const parsed = schema.safeParse(
    toFormDataInput(formData, communityLimitsFormFields)
  );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const result = await withAdminSessionReauth(() =>
    updateTenantCommunityLimitSettings(
      {
        expectedRevision: parsed.data.expectedRevision,
        overrides: parsed.data.overrides,
        tenantId,
      },
      locale
    )
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  // Read through a private cache: without this the screen keeps the previous
  // limits, and the revision the next save is checked against, all session.
  updateTag(tenantCommunityLimitsCacheTag(tenantId));

  return {
    message: t("admin.settings.policy.community.saved"),
    ok: true,
  };
};

export const updateTenantRetentionSettingsAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const t = await getMessagesFor(locale);
  const tenantId = String(formData.get("tenant_id") ?? "").trim();
  if (!tenantId) {
    return { message: t("admin.settings.tenant_missing"), ok: false };
  }

  const schema = await retentionSettingsFormSchema(locale);
  const parsed = schema.safeParse(
    toFormDataInput(formData, retentionSettingsFormFields)
  );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const result = await withAdminSessionReauth(() =>
    updateTenantRetentionSettings(
      {
        expectedRevision: parsed.data.expectedRevision,
        overrides: parsed.data.overrides,
        tenantId,
      },
      locale
    )
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(tenantRetentionSettingsCacheTag(tenantId));

  return {
    message: t("admin.settings.policy.retention.saved"),
    ok: true,
  };
};
