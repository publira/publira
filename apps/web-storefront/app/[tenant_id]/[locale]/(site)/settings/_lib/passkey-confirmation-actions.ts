"use server";

import { rpcErrorMessage } from "@publira/api-client/error-messages";
import { toFormDataInput } from "@publira/utils/form-data";
import { z } from "zod";

import { beginMyPasskeyConfirmation } from "#lib/auth";
import { returnToFormSchema, tenantIdSchema } from "#lib/auth-input";
import {
  requirePublicSession,
  withPublicSessionReauth,
} from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { localeFormSchema, requireFormLocale } from "#lib/locale-form";
import { getMessagesFor } from "#lib/messages";

import type { PasskeyConfirmationStartState } from "./passkey-confirmation-state";

const passkeyConfirmationFormSchema = z.object({
  locale: localeFormSchema,
  returnTo: returnToFormSchema,
  tenantId: tenantIdSchema,
});

/**
 * Begin the assertion that confirms an account deletion or an email change in
 * place of a password. `returnTo` is the settings screen the form is on, for
 * a session that has to be signed in again to come back to.
 */
export const beginPasskeyConfirmationAction = async (
  formData: FormData
): Promise<PasskeyConfirmationStartState> => {
  await assertSameOrigin();
  const submittedLocale = requireFormLocale(formData.get("locale"));
  const t = await getMessagesFor(submittedLocale);

  const parsed = passkeyConfirmationFormSchema.safeParse(
    toFormDataInput(formData, {
      locale: "value",
      returnTo: "value",
      tenantId: "value",
    })
  );

  if (!parsed.success) {
    return {
      message: t("storefront.settings.passkey_confirm_failed"),
      ok: false,
    };
  }

  const { locale, returnTo, tenantId } = parsed.data;
  const accessToken = await requirePublicSession(locale, returnTo, tenantId);

  const started = await withPublicSessionReauth(
    locale,
    returnTo,
    () => beginMyPasskeyConfirmation(tenantId, accessToken),
    tenantId
  );

  if (!started.ok) {
    return {
      message: rpcErrorMessage(
        started.error,
        t("storefront.settings.passkey_confirm_failed"),
        {
          locale,
          overrides: {
            precondition: t("storefront.settings.passkey_confirm_none"),
          },
        }
      ),
      ok: false,
    };
  }

  return { message: "", ok: true, optionsJson: started.optionsJson };
};
