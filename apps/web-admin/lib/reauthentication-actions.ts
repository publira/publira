"use server";

import type * as ActionForm from "@publira/ui-components/action-form";
import { z } from "zod";

import { getActionLocale } from "./action-messages";
import { beginAdminPasskeyConfirmation } from "./admin-mfa";
import {
  mfaCodeFormSchema,
  passkeyCredentialFormSchema,
  tenantIdFormSchema,
} from "./auth-input";
import { withAdminSessionReauth } from "./auth-session";
import { assertSameOrigin } from "./csrf";
import { getMessagesFor } from "./messages";
import type { PasskeyCeremonyStartState } from "./mfa-action-state";
import { reauthenticateAdmin } from "./reauthentication";
import type { ReauthenticateAdminInput } from "./reauthentication";

const proofFieldSchema = z.string().max(1024).catch("");

/**
 * The one proof the dialog's form carries: the password typed in, or else the
 * code typed in, or else the assertion `usePasskeyConfirmation` had one of
 * the account's passkeys make. `null` when it carries none.
 */
const parseProof = (formData: FormData): ReauthenticateAdminInput | null => {
  const password = proofFieldSchema.parse(formData.get("password") ?? "");

  if (password !== "") {
    return { password };
  }

  const code = mfaCodeFormSchema.safeParse(formData.get("confirmation_code"));

  const credential = passkeyCredentialFormSchema.safeParse(
    formData.get("confirmation_credential")
  );

  if (!(code.success || credential.success)) {
    return null;
  }

  return {
    confirmation: {
      code: code.success ? code.data : "",
      passkeyCredentialJson:
        !code.success && credential.success ? credential.data : "",
    },
  };
};

/**
 * Prove the operator again and keep the step-up token it earns, so the form
 * the API refused for want of one can be sent again.
 */
export const reauthenticateAction = async (
  _previousState: ActionForm.State,
  formData: FormData
): Promise<ActionForm.State> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);

  const [t, tenantIdSchema] = await Promise.all([
    getMessagesFor(locale),
    tenantIdFormSchema(locale),
  ]);

  const tenantId = tenantIdSchema.safeParse(formData.get("tenant_id"));

  if (!tenantId.success) {
    return { message: t("admin.settings.tenant_missing"), ok: false };
  }

  const proof = parseProof(formData);

  if (!proof) {
    const required = t("admin.reauthentication.errors.password_required");

    return {
      fieldErrors: { password: required },
      message: required,
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
    reauthenticateAdmin(tenantId.data, proof, locale)
  );

  if (!result.ok) {
    return {
      fieldErrors: result.fieldErrors,
      message: result.message,
      ok: false,
    };
  }

  return { message: "", ok: true };
};

/**
 * Begin the assertion the dialog has one of the account's passkeys make, in
 * place of the password.
 */
export const beginReauthenticationPasskeyAction = async (
  formData: FormData
): Promise<PasskeyCeremonyStartState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);

  const [t, tenantIdSchema] = await Promise.all([
    getMessagesFor(locale),
    tenantIdFormSchema(locale),
  ]);

  const tenantId = tenantIdSchema.safeParse(formData.get("tenant_id"));

  if (!tenantId.success) {
    return { message: t("admin.settings.tenant_missing"), ok: false };
  }

  const result = await withAdminSessionReauth(() =>
    beginAdminPasskeyConfirmation(tenantId.data, locale)
  );

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  return { message: "", ok: true, optionsJson: result.optionsJson };
};
