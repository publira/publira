"use server";

import type { Locale } from "@publira/i18n";
import { toFieldErrors } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { z } from "zod";

import { getActionLocale } from "#lib/action-messages";
import { withAdminSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import {
  optionalBoundedIntFormSchema,
  requiredTrimmedString,
} from "#lib/form-schemas";
import { getMessagesFor } from "#lib/messages";
import { updateRoyaltyClosePolicy } from "#lib/royalties";
import {
  MAX_ROYALTY_AUTO_CLOSE_DAY,
  ROYALTY_CLOSE_MODES,
} from "#lib/royalty-period";

import type { RoyaltyCloseSettingsFormState } from "../../royalty-types";

const royaltyCloseSettingsFormFields = {
  autoCloseDay: { kind: "value", name: "auto_close_day" },
  closeMode: { kind: "value", name: "close_mode" },
  tenantId: { kind: "value", name: "tenant_id" },
} as const;

const royaltyCloseSettingsSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);
  const dayError = t("admin.settings.royalties.validation.day_required");

  return z
    .object({
      autoCloseDay: optionalBoundedIntFormSchema(dayError, {
        max: MAX_ROYALTY_AUTO_CLOSE_DAY,
        min: 1,
      }),
      closeMode: z.enum(ROYALTY_CLOSE_MODES, {
        error: t("admin.settings.royalties.validation.mode_required"),
      }),
      tenantId: requiredTrimmedString(t("admin.settings.tenant_missing")),
    })
    .superRefine((value, ctx) => {
      if (value.closeMode === "automatic" && value.autoCloseDay === undefined) {
        ctx.addIssue({
          code: "custom",
          message: dayError,
          path: ["autoCloseDay"],
        });
      }
    });
};

export const updateRoyaltyCloseSettingsAction = async (
  _prevState: RoyaltyCloseSettingsFormState,
  formData: FormData
): Promise<RoyaltyCloseSettingsFormState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    royaltyCloseSettingsSchema(locale),
  ]);
  const parsed = schema.safeParse(
    toFormDataInput(formData, royaltyCloseSettingsFormFields)
  );
  if (!parsed.success) {
    return {
      fieldErrors: toFieldErrors(parsed.error),
      message: t("errors.validation"),
      ok: false,
    };
  }

  const { autoCloseDay, closeMode, tenantId } = parsed.data;
  const result = await withAdminSessionReauth(() =>
    updateRoyaltyClosePolicy({ autoCloseDay, closeMode, tenantId }, locale)
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  return {
    message: t("admin.settings.royalties.saved"),
    ok: true,
    policy: result.policy,
  };
};
