"use server";

import type { Locale } from "@publira/i18n";
import type { FormActionState } from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { accountCacheTag, deleteMe, updateMe } from "#lib/auth";
import {
  birthDateFormSchema,
  passkeyCredentialFormSchema,
  tenantIdFormSchema,
  tenantIdSchema,
} from "#lib/auth-input";
import {
  clearPublicSessionCookie,
  requirePublicSession,
  withPublicSessionReauth,
} from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { localeFormSchema, requireFormLocale } from "#lib/locale-form";
import { getMessagesFor } from "#lib/messages";
import { tenantLocalePath } from "#lib/tenant-locale-path";

import { buildSettingsPath } from "./settings-form";

const SETTINGS_RETURN_TO = "/settings";

const updateProfileFormSchema = async (locale: Locale) => {
  const [t, birthDate, tenantId] = await Promise.all([
    getMessagesFor(locale),
    birthDateFormSchema(locale),
    tenantIdFormSchema(locale),
  ]);
  const nameRequired = t("storefront.settings.name_required");

  return z.object({
    birthDate,
    locale: localeFormSchema,
    name: z
      .string({ error: nameRequired })
      .trim()
      .min(1, nameRequired)
      .max(100, t("storefront.settings.name_too_long")),
    tenantId,
  });
};

export const updateProfileAction = async (
  formData: FormData
): Promise<void> => {
  await assertSameOrigin();
  // The locale field falls back rather than failing, so a rejected submission
  // is still worded in the reader's language.
  const submittedLocale = requireFormLocale(formData.get("locale"));
  const [t, schema] = await Promise.all([
    getMessagesFor(submittedLocale),
    updateProfileFormSchema(submittedLocale),
  ]);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      birthDate: "value",
      locale: "value",
      name: "value",
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    const errorPath = await buildSettingsPath(
      submittedLocale,
      String(formData.get("tenantId") ?? ""),
      "error",
      toFormErrorMessage(parsed.error, { locale: submittedLocale })
    );
    redirect(errorPath);
  }

  const { birthDate, locale, name, tenantId } = parsed.data;
  const accessToken = await requirePublicSession(
    locale,
    SETTINGS_RETURN_TO,
    tenantId
  );
  const updated = await withPublicSessionReauth(
    locale,
    SETTINGS_RETURN_TO,
    () => updateMe(tenantId, { birthDate, name }, accessToken),
    tenantId
  );
  if (!updated) {
    const errorPath = await buildSettingsPath(
      locale,
      tenantId,
      "error",
      t("storefront.settings.profile_update_failed")
    );
    redirect(errorPath);
  }

  // The site header names the reader from the private account read.
  updateTag(accountCacheTag(tenantId));
  const successPath = await buildSettingsPath(
    locale,
    tenantId,
    "success",
    t("storefront.settings.profile_updated")
  );
  redirect(successPath);
};

const deleteAccountWithPasskeyFormSchema = z.object({
  locale: localeFormSchema,
  passkeyCredential: passkeyCredentialFormSchema,
  tenantId: tenantIdSchema,
});

/**
 * Delete the account of a reader without a password, confirmed with an
 * assertion one of their passkeys made. A refusal stays in the dialog, beside
 * the button the reader can try again with; a deletion signs them out and
 * ends on the sign-in page, as one confirmed with a password does.
 */
export const deleteAccountWithPasskeyAction = async (
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const submittedLocale = requireFormLocale(formData.get("locale"));
  const t = await getMessagesFor(submittedLocale);
  const parsed = deleteAccountWithPasskeyFormSchema.safeParse(
    toFormDataInput(formData, {
      locale: "value",
      passkeyCredential: "value",
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    return { message: t("storefront.settings.delete_failed"), ok: false };
  }

  const { locale, passkeyCredential, tenantId } = parsed.data;
  const accessToken = await requirePublicSession(
    locale,
    SETTINGS_RETURN_TO,
    tenantId
  );
  // An assertion that does not verify is `invalid_argument`, not
  // `unauthenticated`, so it stays a form error instead of ending the session.
  const outcome = await withPublicSessionReauth(
    locale,
    SETTINGS_RETURN_TO,
    () => deleteMe(tenantId, { passkeyCredential }, accessToken),
    tenantId
  );
  if (outcome === "last_tenant_admin") {
    return {
      message: t("storefront.settings.delete_last_tenant_admin"),
      ok: false,
    };
  }
  if (outcome !== "deleted") {
    return { message: t("storefront.settings.delete_failed"), ok: false };
  }

  await clearPublicSessionCookie();
  const params = new URLSearchParams({
    message: t("storefront.settings.deleted"),
    status: "success",
  });
  const loginPath = await tenantLocalePath(tenantId, locale, "/login");
  redirect(`${loginPath}?${params.toString()}`);
};
