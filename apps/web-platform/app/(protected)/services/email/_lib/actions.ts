"use server";

import type { Locale } from "@publira/i18n";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { z } from "zod";

import { platformAuditLogsCacheTag } from "#lib/audit-logs";
import { withPlatformSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import {
  platformEmailSettingsCacheTag,
  sendPlatformSmtpTestEmail,
  updatePlatformEmailSettings,
} from "#lib/email-settings";
import type { PlatformSmtpSettings } from "#lib/email-settings-shared";
import {
  SECRET_UPDATE_MODE_REPLACE,
  SECRET_UPDATE_MODE_UNCHANGED,
  TEST_EMAIL_RECIPIENT_TYPE_CUSTOM,
  TEST_EMAIL_RECIPIENT_TYPE_SELF,
} from "#lib/email-settings-shared";
import {
  intFormSchema,
  optionalTrimmedString,
  revisionFormSchema,
} from "#lib/form-schemas";
import { getPlatformLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";

export type PlatformEmailSettingsFormState =
  | { message: string; ok: false }
  | { message: string; ok: true; settings: PlatformSmtpSettings }
  | null;

export type PlatformSmtpTestFormState =
  | { message: string; ok: false }
  | { message: string; ok: true; recipientEmail: string }
  | null;

const loadActionCatalog = async () => {
  const locale = await getPlatformLocale();
  const t = await getMessagesFor(locale);

  return { locale, t };
};

const secretUpdateModeFormSchema = z.preprocess((value) => {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw === String(SECRET_UPDATE_MODE_REPLACE)
    ? SECRET_UPDATE_MODE_REPLACE
    : SECRET_UPDATE_MODE_UNCHANGED;
}, z.number());

const recipientTypeFormSchema = z.preprocess((value) => {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw === String(TEST_EMAIL_RECIPIENT_TYPE_CUSTOM)
    ? TEST_EMAIL_RECIPIENT_TYPE_CUSTOM
    : TEST_EMAIL_RECIPIENT_TYPE_SELF;
}, z.number());

const smtpFormSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    encryption: z.preprocess(
      (value) =>
        typeof value === "string" ? value.trim().toLowerCase() : value,
      z.enum(["none", "starttls", "tls"], {
        error: t("platform.settings.encryption_required"),
      })
    ),
    fromAddress: optionalTrimmedString(),
    host: optionalTrimmedString(),
    password: z.preprocess(
      (value) => (typeof value === "string" ? value : ""),
      z.string()
    ),
    passwordUpdateMode: secretUpdateModeFormSchema,
    port: intFormSchema(t("platform.settings.port_invalid"), {
      fallback: 587,
      max: 65_535,
      min: 1,
    }),
    recipientEmail: optionalTrimmedString(),
    recipientType: recipientTypeFormSchema,
    replyTo: optionalTrimmedString(),
    username: optionalTrimmedString(),
  });
};

/**
 * A save also states the revision the form was rendered at. The connection test
 * writes nothing, so it does not take one.
 */
const smtpSaveFormSchema = async (locale: Locale) => {
  const [schema, t] = await Promise.all([
    smtpFormSchema(locale),
    getMessagesFor(locale),
  ]);

  return schema.extend({
    revision: revisionFormSchema(t("platform.policy.revision_invalid")),
  });
};

const smtpFormFields = {
  encryption: "value",
  fromAddress: { kind: "value", name: "from_address" },
  host: "value",
  password: "value",
  passwordUpdateMode: { kind: "value", name: "password_update_mode" },
  port: "value",
  recipientEmail: { kind: "value", name: "recipient_email" },
  recipientType: { kind: "value", name: "recipient_type" },
  replyTo: { kind: "value", name: "reply_to" },
  revision: "value",
  username: "value",
} as const;

export const updatePlatformEmailSettingsAction = async (
  _prevState: PlatformEmailSettingsFormState,
  formData: FormData
): Promise<PlatformEmailSettingsFormState> => {
  await assertSameOrigin();
  const { locale, t } = await loadActionCatalog();
  const schema = await smtpSaveFormSchema(locale);

  const parsed = schema.safeParse(toFormDataInput(formData, smtpFormFields));
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const result = await withPlatformSessionReauth(() =>
    updatePlatformEmailSettings({
      encryption: parsed.data.encryption,
      expectedRevision: parsed.data.revision,
      fromAddress: parsed.data.fromAddress,
      host: parsed.data.host,
      locale,
      password: parsed.data.password,
      passwordUpdateMode: parsed.data.passwordUpdateMode,
      port: parsed.data.port,
      replyTo: parsed.data.replyTo,
      username: parsed.data.username,
    })
  );

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(platformEmailSettingsCacheTag);
  updateTag(platformAuditLogsCacheTag);
  return {
    message: t("platform.settings.smtp_saved"),
    ok: true,
    settings: result.settings,
  };
};

export const sendPlatformSmtpTestEmailAction = async (
  _prevState: PlatformSmtpTestFormState,
  formData: FormData
): Promise<PlatformSmtpTestFormState> => {
  await assertSameOrigin();
  const { locale, t } = await loadActionCatalog();
  const schema = await smtpFormSchema(locale);

  const parsed = schema.safeParse(toFormDataInput(formData, smtpFormFields));
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const result = await withPlatformSessionReauth(() =>
    sendPlatformSmtpTestEmail({
      encryption: parsed.data.encryption,
      fromAddress: parsed.data.fromAddress,
      host: parsed.data.host,
      locale,
      password: parsed.data.password,
      passwordUpdateMode: parsed.data.passwordUpdateMode,
      port: parsed.data.port,
      recipientEmail: parsed.data.recipientEmail,
      recipientType: parsed.data.recipientType,
      replyTo: parsed.data.replyTo,
      username: parsed.data.username,
    })
  );

  // The API records a failed send as well as a delivered one.
  updateTag(platformAuditLogsCacheTag);

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  return {
    message: t("platform.settings.smtp_test_success", {
      email: result.recipientEmail,
    }),
    ok: true,
    recipientEmail: result.recipientEmail,
  };
};
