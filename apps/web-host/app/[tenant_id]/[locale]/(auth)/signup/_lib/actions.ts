"use server";

import { getMessage } from "@publira/i18n";
import type { FormActionState } from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import { signupPublic } from "#lib/auth";
import {
  emailFormSchema,
  passwordFormSchema,
  tenantIdFormSchema,
} from "#lib/auth-input";
import { assertSameOrigin } from "#lib/csrf";
import {
  setEmailFlashCookie,
  SIGNUP_PENDING_EMAIL_COOKIE,
} from "#lib/email-flash-cookie";
import { localeFormSchema, requireFormLocale } from "#lib/locale-form";
import { loadHostMessages } from "#lib/messages";
import type { HostMessages } from "#lib/messages";
import { tenantLocalePath } from "#lib/tenant-locale-path";

const signupFormSchema = (messages: HostMessages) => {
  const confirmRequired = getMessage(
    messages,
    "host.auth.errors.password_confirm_required"
  );
  const nameRequired = getMessage(messages, "host.auth.errors.name_required");

  return z
    .object({
      confirmPassword: z
        .string({ error: confirmRequired })
        .min(1, confirmRequired)
        .max(
          1024,
          getMessage(messages, "host.auth.errors.password_confirm_too_long")
        ),
      email: emailFormSchema(messages),
      locale: localeFormSchema,
      name: z
        .string({ error: nameRequired })
        .trim()
        .min(1, nameRequired)
        .max(100, getMessage(messages, "host.auth.errors.name_too_long")),
      password: passwordFormSchema(messages),
      tenantId: tenantIdFormSchema(messages),
    })
    .refine((value) => value.password === value.confirmPassword, {
      error: getMessage(messages, "host.auth.errors.password_mismatch"),
      path: ["confirmPassword"],
    });
};

export const signupAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  // The locale field falls back rather than failing, so a rejected submission
  // is still worded in the reader's language.
  const submittedLocale = requireFormLocale(formData.get("locale"));
  const messages = await loadHostMessages(submittedLocale);
  const parsed = signupFormSchema(messages).safeParse(
    toFormDataInput(formData, {
      confirmPassword: "value",
      email: "value",
      locale: "value",
      name: "value",
      password: "value",
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error, { locale: submittedLocale }),
      ok: false,
    };
  }

  const { email, locale, name, password, tenantId } = parsed.data;
  const result = await signupPublic(name, email, password, tenantId);
  if (!result) {
    return {
      message: getMessage(messages, "host.auth.errors.signup_failed"),
      ok: false,
    };
  }

  if (result.pendingVerification) {
    await setEmailFlashCookie(SIGNUP_PENDING_EMAIL_COOKIE, email);
    const pendingPath = await tenantLocalePath(
      tenantId,
      locale,
      "/signup/pending"
    );
    redirect(pendingPath);
  }

  const myPath = await tenantLocalePath(tenantId, locale, "/my");
  redirect(myPath);
};
