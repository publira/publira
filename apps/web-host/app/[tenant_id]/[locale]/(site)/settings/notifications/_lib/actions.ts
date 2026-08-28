"use server";

import { getMessage, parseLocale } from "@publira/i18n";
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
import { localeFormSchema } from "#lib/locale-form";
import { withLocalePrefix } from "#lib/locale-path";
import { loadHostMessages } from "#lib/messages";
import type { HostMessages } from "#lib/messages";

const NOTIFICATION_SETTINGS_RETURN_TO = "/settings/notifications";

const buildSettingsPath = (
  locale: Locale,
  status: "success" | "error",
  message: string
) => {
  const params = new URLSearchParams({ message, status });
  const path = withLocalePrefix(locale, NOTIFICATION_SETTINGS_RETURN_TO);
  return `${path}?${params.toString()}`;
};

const updateNotificationSettingsFormSchema = (messages: HostMessages) =>
  z.object({
    emailNotificationsEnabled: z
      .literal("on", {
        error: getMessage(
          messages,
          "host.settings.email_notifications_invalid"
        ),
      })
      .optional()
      .transform((value) => value === "on"),
    locale: localeFormSchema,
    tenantId: tenantIdFormSchema(messages),
  });

export const updateNotificationSettingsAction = async (
  formData: FormData
): Promise<void> => {
  await assertSameOrigin();
  // The locale field falls back rather than failing, so a rejected submission
  // is still worded in the reader's language.
  const submittedLocale = parseLocale(formData.get("locale"));
  const messages = await loadHostMessages(submittedLocale);
  const parsed = updateNotificationSettingsFormSchema(messages).safeParse(
    toFormDataInput(formData, {
      emailNotificationsEnabled: "value",
      locale: "value",
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    redirect(
      buildSettingsPath(
        submittedLocale,
        "error",
        toFormErrorMessage(parsed.error, { locale: submittedLocale })
      )
    );
  }

  const { emailNotificationsEnabled, locale, tenantId } = parsed.data;
  const accessToken = await requirePublicSession(
    locale,
    NOTIFICATION_SETTINGS_RETURN_TO
  );
  const updated = await withPublicSessionReauth(
    locale,
    NOTIFICATION_SETTINGS_RETURN_TO,
    () =>
      updateNotificationSettings(
        tenantId,
        emailNotificationsEnabled,
        accessToken
      )
  );
  if (!updated) {
    redirect(
      buildSettingsPath(
        locale,
        "error",
        getMessage(messages, "host.settings.email_notifications_update_failed")
      )
    );
  }

  redirect(
    buildSettingsPath(
      locale,
      "success",
      getMessage(messages, "host.settings.email_notifications_updated")
    )
  );
};
