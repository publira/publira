"use server";

import type { Locale } from "@publira/i18n";
import type { FormActionState } from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { platformAuditLogsCacheTag } from "#lib/audit-logs";
import { emailFormSchema } from "#lib/auth-input";
import { withPlatformSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { platformDashboardCacheTag } from "#lib/dashboard";
import { requiredTrimmedString } from "#lib/form-schemas";
import { getPlatformLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import {
  createPlatformOperator,
  platformOperatorsCacheTag,
} from "#lib/operators";

const createOperatorFormSchema = async (locale: Locale) => {
  const [t, email] = await Promise.all([
    getMessagesFor(locale),
    emailFormSchema(locale),
  ]);
  const requiredAll = t("platform.operators.required_all");

  return z.object({
    email,
    name: requiredTrimmedString(requiredAll),
    role: z.enum(
      ["platform_auditor", "platform_operator", "platform_super_admin"],
      { error: requiredAll }
    ),
  });
};

export const createOperatorAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getPlatformLocale();
  const schema = await createOperatorFormSchema(locale);

  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      email: { kind: "value", name: "operator_email" },
      name: { kind: "value", name: "operator_name" },
      role: { kind: "value", name: "operator_role" },
    })
  );
  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error, { locale }),
      ok: false,
    };
  }

  const result = await withPlatformSessionReauth(() =>
    createPlatformOperator({ ...parsed.data, locale })
  );

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(platformOperatorsCacheTag);
  updateTag(platformDashboardCacheTag);
  updateTag(platformAuditLogsCacheTag);
  redirect("/operators");
};
