"use server";

import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requestAdminPasswordReset } from "#lib/admin-auth";
import { emailFormSchema, tenantIdFormSchema } from "#lib/auth-input";

const TENANT_MISSING_MESSAGE = "テナント識別子が見つかりませんでした。";

const forgotPasswordFormSchema = z.object({
  email: emailFormSchema,
  tenantId: tenantIdFormSchema,
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
  const input = toFormDataInput(formData, {
    email: "value",
    tenantId: { kind: "value", name: "tenant_id" },
  });
  const parsed = forgotPasswordFormSchema.safeParse(input);
  if (!parsed.success) {
    const tenantIdResult = tenantIdFormSchema.safeParse(input.tenantId);
    const emailResult = emailFormSchema.safeParse(input.email);
    redirect(
      buildForgotPasswordPath({
        email: emailResult.success ? emailResult.data : undefined,
        error: tenantIdResult.success
          ? toFormErrorMessage(parsed.error)
          : TENANT_MISSING_MESSAGE,
      })
    );
  }

  const { email, tenantId } = parsed.data;
  const result = await requestAdminPasswordReset(tenantId, email);
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
