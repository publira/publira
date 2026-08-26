"use server";

import { getMessage } from "@publira/i18n";
import type { FormActionState } from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import { emailFormSchema } from "#lib/auth-input";
import { withPlatformSessionReauth } from "#lib/auth-session";
import { requiredTrimmedString } from "#lib/form-schemas";
import { getPlatformLocale, loadPlatformMessages } from "#lib/locale";
import type { PlatformMessages } from "#lib/locale";
import { createPlatformOperator } from "#lib/operators";

const createOperatorFormSchema = (messages: PlatformMessages) => {
  const requiredAll = getMessage(messages, "platform.operators.required_all");

  return z.object({
    email: emailFormSchema(messages),
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
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  const parsed = createOperatorFormSchema(messages).safeParse(
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

  redirect("/operators");
};
