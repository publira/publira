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
import { withPlatformSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { getPlatformLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import {
  platformSettingsCacheTag,
  updatePlatformDefaultLocale,
  updatePlatformDefaultTimezone,
} from "#lib/platform-settings";
import { platformSetupStatusCacheTag } from "#lib/setup-status";

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
