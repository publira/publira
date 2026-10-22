"use server";

import type { Locale } from "@publira/i18n";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import { updateNotificationSettings } from "#lib/auth";
import { tenantIdFormSchema } from "#lib/auth-input";
import {
  requirePublicSession,
  withPublicSessionReauth,
} from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { localeFormSchema, requireFormLocale } from "#lib/locale-form";
import { getMessagesFor } from "#lib/messages";
import { tenantLocalePath } from "#lib/tenant-locale-path";

const NOTIFICATION_SETTINGS_RETURN_TO = "/settings/notifications";

const buildSettingsPath = async (
  locale: Locale,
  tenantId: string,
  status: "success" | "error",
  message: string
): Promise<string> => {
  const params = new URLSearchParams({ message, status });
  const path = await tenantLocalePath(
    tenantId,
    locale,
    NOTIFICATION_SETTINGS_RETURN_TO
  );
  return `${path}?${params.toString()}`;
};

const updateNotificationSettingsFormSchema = async (locale: Locale) => {
  const [t, tenantId] = await Promise.all([
    getMessagesFor(locale),
    tenantIdFormSchema(locale),
  ]);

  // A switch submits "on" and an unchecked one nothing at all, so a missing
  // field is a switch that is off.
  const switchSchema = z
    .literal("on", {
      error: t("storefront.settings.notification_preferences_invalid"),
    })
    .optional()
    .transform((value) => value === "on");

  return z.object({
    announcementsEmailEnabled: switchSchema,
    announcementsInboxEnabled: switchSchema,
    commentsEmailEnabled: switchSchema,
    commentsInboxEnabled: switchSchema,
    followedCreatorsEmailEnabled: switchSchema,
    followedCreatorsInboxEnabled: switchSchema,
    followedCreatorsMobilePushEnabled: switchSchema,
    followedCreatorsWebPushEnabled: switchSchema,
    followedEpisodesEmailEnabled: switchSchema,
    followedEpisodesInboxEnabled: switchSchema,
    followedEpisodesMobilePushEnabled: switchSchema,
    followedEpisodesWebPushEnabled: switchSchema,
    locale: localeFormSchema,
    tenantId,
  });
};

export const updateNotificationSettingsAction = async (
  formData: FormData
): Promise<void> => {
  await assertSameOrigin();
  // The locale field falls back rather than failing, so a rejected submission
  // is still worded in the reader's language.
  const submittedLocale = requireFormLocale(formData.get("locale"));
  const [t, schema] = await Promise.all([
    getMessagesFor(submittedLocale),
    updateNotificationSettingsFormSchema(submittedLocale),
  ]);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      announcementsEmailEnabled: "value",
      announcementsInboxEnabled: "value",
      commentsEmailEnabled: "value",
      commentsInboxEnabled: "value",
      followedCreatorsEmailEnabled: "value",
      followedCreatorsInboxEnabled: "value",
      followedCreatorsMobilePushEnabled: "value",
      followedCreatorsWebPushEnabled: "value",
      followedEpisodesEmailEnabled: "value",
      followedEpisodesInboxEnabled: "value",
      followedEpisodesMobilePushEnabled: "value",
      followedEpisodesWebPushEnabled: "value",
      locale: "value",
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

  const { locale, tenantId, ...preferences } = parsed.data;
  const accessToken = await requirePublicSession(
    locale,
    NOTIFICATION_SETTINGS_RETURN_TO,
    tenantId
  );
  const updated = await withPublicSessionReauth(
    locale,
    NOTIFICATION_SETTINGS_RETURN_TO,
    () => updateNotificationSettings(tenantId, preferences, accessToken),
    tenantId
  );
  if (!updated) {
    const errorPath = await buildSettingsPath(
      locale,
      tenantId,
      "error",
      t("storefront.settings.notification_preferences_update_failed")
    );
    redirect(errorPath);
  }

  const successPath = await buildSettingsPath(
    locale,
    tenantId,
    "success",
    t("storefront.settings.notification_preferences_updated")
  );
  redirect(successPath);
};
