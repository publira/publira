"use server";

import { rpcErrorMessage } from "@publira/api-client/error-messages";
import type { Locale } from "@publira/i18n";
import type * as ActionForm from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  beginMyPasskeyRegistration,
  deleteMyPasskey,
  finishMyPasskeyRegistration,
  renameMyPasskey,
} from "#lib/auth";
import type { AccountConfirmation } from "#lib/auth";
import { passkeyCredentialFormSchema, tenantIdSchema } from "#lib/auth-input";
import {
  requirePublicSession,
  withPublicSessionReauth,
} from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { localeFormSchema, requireFormLocale } from "#lib/locale-form";
import { getMessagesFor } from "#lib/messages";
import {
  clearPendingPasskeyRegistration,
  readPendingPasskeyRegistration,
} from "#lib/pending-passkey-registration";
import { SIGN_IN_PROVIDERS } from "#lib/sign-in-provider";
import { sendToProvider } from "#lib/social-sign-in-start";
import { tenantLocalePath } from "#lib/tenant-locale-path";

import { confirmationRefusalMessage } from "./confirmation-refusal";
import type {
  PasskeyRegistrationStartState,
  PasskeyRegistrationState,
} from "./passkey-state";
import {
  buildSecuritySettingsPath,
  SECURITY_SETTINGS_RETURN_TO,
} from "./security-path";

/**
 * A passkey's public id, as a row submits it. The API answers `not_found` for
 * one that is not the caller's, so only its shape is checked here.
 */
const passkeyIdFormSchema = z.string().trim().min(1).max(64);

const passkeyFormSchema = z.object({
  locale: localeFormSchema,
  tenantId: tenantIdSchema,
});

const passkeyCredentialSchema = passkeyFormSchema.extend({
  credential: passkeyCredentialFormSchema,
});

/**
 * The confirmation a form carries: the current password it asked for, or the
 * assertion `PasskeyConfirmation` added as `passkeyCredential`. A form that
 * sends neither, or both, did not come from the page and confirms nothing.
 */
const confirmationSchema = z
  .object({
    passkeyCredential: passkeyCredentialFormSchema.optional(),
    password: z.string().min(1).max(1024).optional(),
  })
  .transform(
    ({ passkeyCredential, password }, context): AccountConfirmation => {
      if (password && !passkeyCredential) {
        return { password };
      }

      if (passkeyCredential && !password) {
        return { passkeyCredential };
      }

      context.addIssue({ code: "custom", message: "one confirmation" });

      return z.NEVER;
    }
  );

/** Which confirmation a dialog's form sends: its password or an assertion. */
type ConfirmedWith = "passkey" | "password";

const confirmedWith = (confirmation: AccountConfirmation): ConfirmedWith =>
  "password" in confirmation ? "password" : "passkey";

const confirmationInput = (formData: FormData) =>
  toFormDataInput(formData, { passkeyCredential: "value", password: "value" });

/**
 * Begin registering a passkey for the signed-in reader, with the password or
 * the assertion of another passkey the form confirmed the account with. A
 * refusal is a confirmation that did not verify, the account holding as many
 * passkeys as it may, or anything else the API turned away, and stays on the
 * form.
 */
export const beginPasskeyRegistrationAction = async (
  formData: FormData
): Promise<PasskeyRegistrationStartState> => {
  await assertSameOrigin();
  const submittedLocale = requireFormLocale(formData.get("locale"));
  const t = await getMessagesFor(submittedLocale);

  const parsed = passkeyFormSchema.safeParse(
    toFormDataInput(formData, { locale: "value", tenantId: "value" })
  );

  const confirmation = confirmationSchema.safeParse(
    confirmationInput(formData)
  );

  if (!(parsed.success && confirmation.success)) {
    return {
      message: t("storefront.settings.passkey_add_failed"),
      ok: false,
    };
  }

  const { locale, tenantId } = parsed.data;

  const accessToken = await requirePublicSession(
    locale,
    SECURITY_SETTINGS_RETURN_TO,
    tenantId
  );

  const started = await withPublicSessionReauth(
    locale,
    SECURITY_SETTINGS_RETURN_TO,
    () => beginMyPasskeyRegistration(tenantId, confirmation.data, accessToken),
    tenantId
  );

  if (!started.ok) {
    return {
      message: confirmationRefusalMessage(
        t,
        locale,
        started,
        confirmation.data,
        t("storefront.settings.passkey_add_failed"),
        { precondition: t("storefront.settings.passkey_limit") }
      ),
      ok: false,
    };
  }

  return { message: "", ok: true, optionsJson: started.optionsJson };
};

/**
 * Begin the registration a fresh sign-in to a provider confirmed, with the
 * sign-in the callback left waiting. The sign-in is spent here whatever the
 * API answers, so a refusal, or a sign-in that has expired while the page was
 * open, goes back to the page with **Add a passkey** offered again and says
 * why.
 */
export const beginPendingPasskeyRegistrationAction = async (
  formData: FormData
): Promise<PasskeyRegistrationStartState> => {
  await assertSameOrigin();
  const submittedLocale = requireFormLocale(formData.get("locale"));
  const t = await getMessagesFor(submittedLocale);

  const parsed = passkeyFormSchema.safeParse(
    toFormDataInput(formData, { locale: "value", tenantId: "value" })
  );

  if (!parsed.success) {
    return {
      message: t("storefront.settings.passkey_add_failed"),
      ok: false,
    };
  }

  const { locale, tenantId } = parsed.data;

  const [accessToken, pending] = await Promise.all([
    requirePublicSession(locale, SECURITY_SETTINGS_RETURN_TO, tenantId),
    readPendingPasskeyRegistration(tenantId),
  ]);

  await clearPendingPasskeyRegistration();

  if (!pending) {
    redirect(
      await buildSecuritySettingsPath(
        locale,
        tenantId,
        "error",
        t("storefront.settings.confirm_unconfirmed")
      )
    );
  }

  const { idToken, nonce, provider } = pending;

  const started = await withPublicSessionReauth(
    locale,
    SECURITY_SETTINGS_RETURN_TO,
    () =>
      beginMyPasskeyRegistration(
        tenantId,
        { idToken, nonce, provider },
        accessToken
      ),
    tenantId
  );

  if (!started.ok) {
    redirect(
      await buildSecuritySettingsPath(
        locale,
        tenantId,
        "error",
        rpcErrorMessage(
          started.error,
          t("storefront.settings.passkey_add_failed"),
          {
            locale,
            overrides: {
              "invalid-argument": t("storefront.settings.confirm_unconfirmed"),
              precondition: t("storefront.settings.passkey_limit"),
            },
          }
        )
      )
    );
  }

  return { message: "", ok: true, optionsJson: started.optionsJson };
};

/**
 * Drop the sign-in waiting to confirm a passkey, so the page offers **Add a
 * passkey** again.
 */
export const discardPendingPasskeyRegistrationAction = async (
  formData: FormData
): Promise<void> => {
  await assertSameOrigin();

  const parsed = passkeyFormSchema.safeParse(
    toFormDataInput(formData, { locale: "value", tenantId: "value" })
  );

  await clearPendingPasskeyRegistration();

  // Every field is hidden, so a form that fails here was not the page's, and
  // there is nowhere to send it back to.
  if (!parsed.success) {
    return;
  }

  redirect(
    await tenantLocalePath(
      parsed.data.tenantId,
      parsed.data.locale,
      SECURITY_SETTINGS_RETURN_TO
    )
  );
};

/**
 * Store the passkey the browser created. The list behind the form is read
 * again, so the new passkey is there, unnamed, while the reader names it.
 */
export const finishPasskeyRegistrationAction = async (
  formData: FormData
): Promise<PasskeyRegistrationState> => {
  await assertSameOrigin();
  const submittedLocale = requireFormLocale(formData.get("locale"));
  const t = await getMessagesFor(submittedLocale);

  const parsed = passkeyCredentialSchema.safeParse(
    toFormDataInput(formData, {
      credential: "value",
      locale: "value",
      tenantId: "value",
    })
  );

  if (!parsed.success) {
    return {
      message: t("storefront.settings.passkey_add_failed"),
      ok: false,
    };
  }

  const { credential, locale, tenantId } = parsed.data;

  const accessToken = await requirePublicSession(
    locale,
    SECURITY_SETTINGS_RETURN_TO,
    tenantId
  );

  const finished = await withPublicSessionReauth(
    locale,
    SECURITY_SETTINGS_RETURN_TO,
    () => finishMyPasskeyRegistration(tenantId, credential, accessToken),
    tenantId
  );

  if (!finished.ok) {
    return {
      message: rpcErrorMessage(
        finished.error,
        t("storefront.settings.passkey_add_failed"),
        {
          locale,
          overrides: {
            conflict: t("storefront.settings.passkey_already_registered"),
            "invalid-argument": t("storefront.settings.passkey_add_failed"),
            precondition: t("storefront.settings.passkey_limit"),
          },
        }
      ),
      ok: false,
    };
  }

  // The naming step that takes the form's place reports the addition.
  refresh();

  return { message: "", ok: true, passkeyId: finished.passkey.id };
};

const namePasskeyFormSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return passkeyFormSchema.extend({
    name: z
      .string()
      .trim()
      .max(64, t("storefront.settings.passkey_name_too_long")),
    passkeyId: passkeyIdFormSchema,
  });
};

/** Name the passkey the reader has just added. */
export const namePasskeyAction = async (
  _previousState: ActionForm.State,
  formData: FormData
): Promise<ActionForm.State> => {
  await assertSameOrigin();
  const submittedLocale = requireFormLocale(formData.get("locale"));

  const [t, schema] = await Promise.all([
    getMessagesFor(submittedLocale),
    namePasskeyFormSchema(submittedLocale),
  ]);

  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      locale: "value",
      name: "value",
      passkeyId: "value",
      tenantId: "value",
    })
  );

  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error, {
        fallback: t("storefront.settings.passkey_name_failed"),
        locale: submittedLocale,
      }),
      ok: false,
    };
  }

  const { locale, name, passkeyId, tenantId } = parsed.data;

  const accessToken = await requirePublicSession(
    locale,
    SECURITY_SETTINGS_RETURN_TO,
    tenantId
  );

  const renamed = await withPublicSessionReauth(
    locale,
    SECURITY_SETTINGS_RETURN_TO,
    () => renameMyPasskey(tenantId, passkeyId, name, accessToken),
    tenantId
  );

  if (!renamed.ok) {
    return {
      message: rpcErrorMessage(
        renamed.error,
        t("storefront.settings.passkey_name_failed"),
        {
          locale,
          overrides: {
            "not-found": t("storefront.settings.passkey_not_found"),
          },
        }
      ),
      ok: false,
    };
  }

  // The add form takes the naming step's place, and the row the new name.
  refresh();

  return { message: "", ok: true };
};

const removePasskeyFormSchema = passkeyFormSchema.extend({
  passkeyId: passkeyIdFormSchema,
});

/**
 * Remove one of the reader's passkeys, confirmed with the password or an
 * assertion, and go back to the page with the outcome. A refusal stays in the
 * dialog the removal was confirmed in, worded for the confirmation or, for the
 * last way into an account without a password, in the words the row's hint
 * uses.
 */
const removePasskey = async (
  formData: FormData,
  expected: ConfirmedWith
): Promise<ActionForm.State> => {
  const submittedLocale = requireFormLocale(formData.get("locale"));
  const t = await getMessagesFor(submittedLocale);

  const parsed = removePasskeyFormSchema.safeParse(
    toFormDataInput(formData, {
      locale: "value",
      passkeyId: "value",
      tenantId: "value",
    })
  );

  const confirmation = confirmationSchema.safeParse(
    confirmationInput(formData)
  );

  if (
    !(
      parsed.success &&
      confirmation.success &&
      confirmedWith(confirmation.data) === expected
    )
  ) {
    return {
      message: t("storefront.settings.passkey_remove_failed"),
      ok: false,
    };
  }

  const { locale, passkeyId, tenantId } = parsed.data;

  const accessToken = await requirePublicSession(
    locale,
    SECURITY_SETTINGS_RETURN_TO,
    tenantId
  );

  const removed = await withPublicSessionReauth(
    locale,
    SECURITY_SETTINGS_RETURN_TO,
    () => deleteMyPasskey(tenantId, passkeyId, confirmation.data, accessToken),
    tenantId
  );

  if (!removed.ok) {
    return {
      message: confirmationRefusalMessage(
        t,
        locale,
        removed,
        confirmation.data,
        t("storefront.settings.passkey_remove_failed"),
        {
          "not-found": t("storefront.settings.passkey_not_found"),
          precondition: t("storefront.settings.passkey_last"),
        }
      ),
      ok: false,
    };
  }

  redirect(
    await buildSecuritySettingsPath(
      locale,
      tenantId,
      "success",
      t("storefront.settings.passkey_removed")
    )
  );
};

/** Remove a passkey with the password the removal dialog asked for. */
export const deletePasskeyAction = async (
  _previousState: ActionForm.State,
  formData: FormData
): Promise<ActionForm.State> => {
  await assertSameOrigin();

  return removePasskey(formData, "password");
};

/**
 * Remove a passkey of an account without a password, with the assertion
 * `PasskeyConfirmation` added to the dialog's form.
 */
export const deletePasskeyWithPasskeyAction = async (
  formData: FormData
): Promise<ActionForm.State> => {
  await assertSameOrigin();

  return removePasskey(formData, "passkey");
};

const passkeyChangeWithProviderFormSchema = passkeyFormSchema.extend({
  intent: z.enum(["passkey_add", "passkey_remove"]),
  passkeyId: passkeyIdFormSchema.optional(),
  provider: z.enum(SIGN_IN_PROVIDERS),
});

/**
 * Add or remove a passkey of an account without a password, which signs in
 * again with the provider whose button the reader pressed. The passkey to
 * remove waits with the sign-in, and the callback asks for the step with it.
 */
export const confirmPasskeyChangeWithProviderAction = async (
  formData: FormData
): Promise<void> => {
  await assertSameOrigin();
  const submittedLocale = requireFormLocale(formData.get("locale"));
  const t = await getMessagesFor(submittedLocale);

  // A form that names no tenant did not come from the page, and nothing can be
  // built for it to go back to without one: it is turned away as it is.
  const tenant = tenantIdSchema.safeParse(
    toFormDataInput(formData, { tenantId: "value" }).tenantId
  );

  if (!tenant.success) {
    return;
  }

  const parsed = passkeyChangeWithProviderFormSchema.safeParse(
    toFormDataInput(formData, {
      intent: "value",
      locale: "value",
      passkeyId: "value",
      provider: "value",
      tenantId: "value",
    })
  );

  if (
    !parsed.success ||
    (parsed.data.intent === "passkey_remove" && !parsed.data.passkeyId)
  ) {
    redirect(
      await buildSecuritySettingsPath(
        submittedLocale,
        tenant.data,
        "error",
        formData.get("intent") === "passkey_add"
          ? t("storefront.settings.passkey_add_failed")
          : t("storefront.settings.passkey_remove_failed")
      )
    );
  }

  const { intent, locale, passkeyId, provider, tenantId } = parsed.data;

  const accessToken = await requirePublicSession(
    locale,
    SECURITY_SETTINGS_RETURN_TO,
    tenantId
  );

  const request: Parameters<typeof sendToProvider>[0] = {
    accessToken,
    intent,
    locale,
    provider,
    tenantId,
    returnTo: SECURITY_SETTINGS_RETURN_TO,
  };

  if (intent === "passkey_remove" && passkeyId) {
    request.target = passkeyId;
  }

  await sendToProvider(request);
};
