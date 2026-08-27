"use server";

import { getMessage } from "@publira/i18n";
import type { FormActionState } from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import { acceptTenantAdminInvitation } from "#lib/admin-auth";
import { inviteTokenFormSchema, tenantIdFormSchema } from "#lib/auth-input";
import { assertSameOrigin } from "#lib/csrf";
import { optionalTrimmedString } from "#lib/form-schemas";
import { getLocale, loadAdminMessages } from "#lib/locale";
import type { AdminMessages } from "#lib/locale";

const acceptInviteFormSchema = (messages: AdminMessages) =>
  z
    .object({
      accountExists: z.preprocess((value) => value === "true", z.boolean()),
      confirmPassword: optionalTrimmedString(1024),
      email: optionalTrimmedString(),
      name: optionalTrimmedString(),
      password: optionalTrimmedString(1024),
      tenantId: tenantIdFormSchema(messages),
      token: inviteTokenFormSchema(messages),
    })
    .superRefine((value, ctx) => {
      if (value.accountExists) {
        return;
      }

      if (!(value.name && value.password)) {
        ctx.addIssue({
          code: "custom",
          message: getMessage(
            messages,
            "admin.auth.errors.name_and_password_required"
          ),
        });
        return;
      }

      if (value.password !== value.confirmPassword) {
        ctx.addIssue({
          code: "custom",
          message: getMessage(
            messages,
            "admin.auth.accept_invite.password_mismatch"
          ),
        });
      }
    });

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
  const locale = await getLocale();
  const messages = await loadAdminMessages(locale);
  const parsed = acceptInviteFormSchema(messages).safeParse(
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
    accountExists ? undefined : name,
    accountExists ? undefined : password,
    locale
  );

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  redirect(buildLoginPath(email));
};
