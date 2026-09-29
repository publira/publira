"use server";

import type { Locale } from "@publira/i18n";
import type { FormActionState } from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getActionLocale } from "#lib/action-messages";
import { acceptTenantAdminInvitation } from "#lib/admin-auth";
import { inviteTokenFormSchema, tenantIdFormSchema } from "#lib/auth-input";
import { assertSameOrigin } from "#lib/csrf";
import { optionalTrimmedString } from "#lib/form-schemas";
import { getMessagesFor } from "#lib/messages";

const acceptInviteFormSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z
    .object({
      accountExists: z.preprocess((value) => value === "true", z.boolean()),
      confirmPassword: z.string().max(1024).optional(),
      email: optionalTrimmedString(),
      name: optionalTrimmedString(),
      password: z.string().max(1024).optional(),
      tenantId: await tenantIdFormSchema(locale),
      token: await inviteTokenFormSchema(locale),
    })
    .superRefine((value, ctx) => {
      if (value.accountExists) {
        return;
      }

      if (!(value.name && value.password)) {
        ctx.addIssue({
          code: "custom",
          message: t("admin.auth.errors.name_and_password_required"),
        });
        return;
      }

      if (value.password !== value.confirmPassword) {
        ctx.addIssue({
          code: "custom",
          message: t("admin.auth.accept_invite.password_mismatch"),
        });
      }
    });
};
const buildLoginPath = (email: string): string => {
  const params = new URLSearchParams({
    invited: "done",
    next: "/",
  });
  if (email) {
    params.set("email", email);
  }
  return `/login?${params.toString()}`;
};

export const acceptInviteAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const schema = await acceptInviteFormSchema(locale);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      accountExists: { kind: "value", name: "account_exists" },
      confirmPassword: { kind: "value", name: "confirm_password" },
      email: "value",
      name: "value",
      password: "value",
      tenantId: { kind: "value", name: "tenant_id" },
      token: "value",
    })
  );
  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error, { locale }),
      ok: false,
    };
  }

  const { accountExists, email, name, password, tenantId, token } = parsed.data;

  const result = await acceptTenantAdminInvitation(
    tenantId,
    token,
    locale,
    accountExists ? undefined : name,
    accountExists ? undefined : password
  );

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  redirect(buildLoginPath(email));
};
