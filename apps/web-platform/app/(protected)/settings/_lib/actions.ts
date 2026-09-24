"use server";

import { getLocales } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import type { FormActionState } from "@publira/ui-components/action-form";
import { isValidTimeZone } from "@publira/utils";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { z } from "zod";

import { platformAuditLogsCacheTag } from "#lib/audit-logs";
import { emailFormSchema, passwordFormSchema } from "#lib/auth-input";
import { withPlatformSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { requestPlatformEmailChange } from "#lib/email-change";
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
import { intFormSchema, optionalTrimmedString } from "#lib/form-schemas";
import { getPlatformLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import {
  platformSettingsCacheTag,
  updatePlatformDefaultLocale,
  updatePlatformDefaultTimezone,
} from "#lib/platform-settings";
import { platformSetupStatusCacheTag } from "#lib/setup-status";

import { revisionSchema } from "./policy-form-schemas";

export type PlatformEmailSettingsFormState =
  | { message: string; ok: false }
  | { message: string; ok: true; settings: PlatformSmtpSettings }
  | null;

export type PlatformSmtpTestFormState =
  | { message: string; ok: false }
  | { message: string; ok: true; recipientEmail: string }
  | null;

export type PlatformEmailChangeActionState =
  | { message: string; ok: false }
  | { message: string; ok: true }
  | null;

export type PlatformDefaultTimezoneActionState =
  | { defaultTimezone: string; message: string; ok: true }
  | { message: string; ok: false }
  | null;

const loadActionCatalog = async () => {
  const locale = await getPlatformLocale();
  const t = await getMessagesFor(locale);

  return { locale, t };
};

/**
 * The Go server validates against the IANA tzdata it embeds
 * (`server/internal/tenanttz`) and stays the authority; this only gives the
 * operator immediate feedback instead of a round trip.
 */
const platformDefaultTimezoneSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);
  const required = t("platform.settings.timezone_required");

  return z.object({
    defaultTimezone: z
      .string({ error: required })
      .trim()
      .min(1, required)
      .refine(isValidTimeZone, {
        error: t("platform.settings.timezone_invalid"),
      }),
  });
};

/**
 * The Go server validates against the supported locale list
 * (`server/internal/locale`) and stays the authority; this only gives the
 * operator immediate feedback instead of a round trip.
 */
const platformDefaultLocaleSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    defaultLocale: z.enum(getLocales(), {
      error: t("platform.settings.locale_required"),
    }),
  });
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

  return schema.extend({ revision: revisionSchema(t) });
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

const emailChangeFormSchema = async (locale: Locale) => {
  const [currentEmail, currentPassword, newEmail] = await Promise.all([
    emailFormSchema(locale),
    passwordFormSchema(locale),
    emailFormSchema(locale),
  ]);

  return z.object({ currentEmail, currentPassword, newEmail });
};

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

export const updatePlatformDefaultTimezoneAction = async (
  _prevState: PlatformDefaultTimezoneActionState,
  formData: FormData
): Promise<PlatformDefaultTimezoneActionState> => {
  await assertSameOrigin();
  const { locale, t } = await loadActionCatalog();
  const schema = await platformDefaultTimezoneSchema(locale);

  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      defaultTimezone: { kind: "value", name: "default_timezone" },
    })
  );
  if (!parsed.success) {
    // One control, so the field message is the form message.
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const result = await withPlatformSessionReauth(() =>
    updatePlatformDefaultTimezone(parsed.data.defaultTimezone, locale)
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  // The settings screen and the console's timestamps read the setting through a
  // private cache, so without this the operator would keep seeing the previous
  // zone in the same session.
  updateTag(platformSettingsCacheTag);
  updateTag(platformAuditLogsCacheTag);

  return {
    defaultTimezone: result.defaultTimezone,
    message: t("platform.settings.default_timezone_saved"),
    ok: true,
  };
};

export const updatePlatformDefaultLocaleAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const { locale, t } = await loadActionCatalog();
  const schema = await platformDefaultLocaleSchema(locale);

  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      defaultLocale: { kind: "value", name: "default_locale" },
    })
  );
  if (!parsed.success) {
    // One control, so the field message is the form message.
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const result = await withPlatformSessionReauth(() =>
    updatePlatformDefaultLocale(parsed.data.defaultLocale, locale)
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  // The settings screen and the cookie-less `getPlatformLocale()` read the
  // setting through a private cache, so without this the operator would keep
  // seeing the previous language in the same session.
  updateTag(platformSettingsCacheTag);
  updateTag(platformSetupStatusCacheTag);
  updateTag(platformAuditLogsCacheTag);

  return {
    message: t("platform.settings.default_locale_saved"),
    ok: true,
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

export const requestPlatformEmailChangeAction = async (
  _prevState: PlatformEmailChangeActionState,
  formData: FormData
): Promise<PlatformEmailChangeActionState> => {
  await assertSameOrigin();
  const { locale, t } = await loadActionCatalog();
  const schema = await emailChangeFormSchema(locale);

  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      currentEmail: { kind: "value", name: "current_email" },
      currentPassword: { kind: "value", name: "current_password" },
      newEmail: { kind: "value", name: "new_email" },
    })
  );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const result = await withPlatformSessionReauth(() =>
    requestPlatformEmailChange(
      parsed.data.currentEmail,
      parsed.data.newEmail,
      parsed.data.currentPassword,
      locale
    )
  );

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  return {
    message: t("platform.settings.email_change_success"),
    ok: true,
  };
};
