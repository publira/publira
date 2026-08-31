"use server";

import { getMessage } from "@publira/i18n";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getActionLocale } from "#lib/action-messages";
import { requestAdminPasswordReset } from "#lib/admin-auth";
import { emailFormSchema, tenantIdFormSchema } from "#lib/auth-input";
import { assertSameOrigin } from "#lib/csrf";
import { loadAdminMessages } from "#lib/locale";
import type { AdminMessages } from "#lib/locale";

const forgotPasswordFormSchema = (messages: AdminMessages) =>
  z.object({
    email: emailFormSchema(messages),
    tenantId: tenantIdFormSchema(messages),
  });

const buildForgotPasswordPath = ({
  email,
  error,
  requested,
}: {
  email?: string;
  error?: string;
  requested?: boolean;
}): string => {
  const params = new URLSearchParams();

  if (email) {
    params.set("email", email);
  }
  if (error) {
    params.set("error", error);
  }
  if (requested) {
    params.set("requested", "done");
  }

  const query = params.toString();
  return query ? `/forgot-password?${query}` : "/forgot-password";
};

export const requestPasswordResetAction = async (
  formData: FormData
): Promise<void> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const messages = await loadAdminMessages(locale);
  const input = toFormDataInput(formData, {
    email: "value",
    tenantId: { kind: "value", name: "tenant_id" },
  });
  const parsed = forgotPasswordFormSchema(messages).safeParse(input);
  if (!parsed.success) {
    const tenantIdResult = tenantIdFormSchema(messages).safeParse(
      input.tenantId
    );
    const emailResult = emailFormSchema(messages).safeParse(input.email);
    redirect(
      buildForgotPasswordPath({
        email: emailResult.success ? emailResult.data : undefined,
        error: tenantIdResult.success
          ? toFormErrorMessage(parsed.error, { locale })
          : getMessage(messages, "admin.auth.errors.tenant_missing"),
      })
    );
  }

  const { email, tenantId } = parsed.data;
  const result = await requestAdminPasswordReset(tenantId, email, locale);
  if (!result.ok) {
    redirect(
      buildForgotPasswordPath({
        email,
        error: result.message,
      })
    );
  }

  redirect(buildForgotPasswordPath({ requested: true }));
};
