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
import { passkeyCredentialFormSchema, tenantIdSchema } from "#lib/auth-input";
import {
  requirePublicSession,
  withPublicSessionReauth,
} from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { localeFormSchema, requireFormLocale } from "#lib/locale-form";
import { getMessagesFor } from "#lib/messages";

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
 * Begin registering a passkey for the signed-in reader. A refusal is the
 * account holding as many passkeys as it may, or anything else the API turned
 * away, and stays on the form.
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

  if (!parsed.success) {
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
    () => beginMyPasskeyRegistration(tenantId, accessToken),
    tenantId
  );

  if (!started.ok) {
    return {
      message: rpcErrorMessage(
        started.error,
        t("storefront.settings.passkey_add_failed"),
        {
          locale,
          overrides: {
            precondition: t("storefront.settings.passkey_limit"),
          },
        }
      ),
      ok: false,
    };
  }

  return { message: "", ok: true, optionsJson: started.optionsJson };
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

/**
 * Remove one of the reader's passkeys from its row in **Passkeys**, and go
 * back to the page with the outcome, as unlinking a provider does. The last
 * way into an account without a password is refused by the API, in the words
 * the row's hint uses.
 */
export const deletePasskeyAction = async (
  formData: FormData
): Promise<void> => {
  await assertSameOrigin();
  const submittedLocale = requireFormLocale(formData.get("locale"));
  const t = await getMessagesFor(submittedLocale);

  const parsed = passkeyFormSchema
    .extend({ passkeyId: passkeyIdFormSchema })
    .safeParse(
      toFormDataInput(formData, {
        locale: "value",
        passkeyId: "value",
        tenantId: "value",
      })
    );

  if (!parsed.success) {
    redirect(
      await buildSecuritySettingsPath(
        submittedLocale,
        String(formData.get("tenantId") ?? ""),
        "error",
        t("storefront.settings.passkey_remove_failed")
      )
    );
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
    () => deleteMyPasskey(tenantId, passkeyId, accessToken),
    tenantId
  );

  if (!removed.ok) {
    redirect(
      await buildSecuritySettingsPath(
        locale,
        tenantId,
        "error",
        rpcErrorMessage(
          removed.error,
          t("storefront.settings.passkey_remove_failed"),
          {
            locale,
            overrides: {
              "not-found": t("storefront.settings.passkey_not_found"),
              precondition: t("storefront.settings.passkey_last"),
            },
          }
        )
      )
    );
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
