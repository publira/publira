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
import { loadHostMessages } from "#lib/messages";
import type { HostMessages } from "#lib/messages";
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
    const errorPath = await buildSettingsPath(
      submittedLocale,
      String(formData.get("tenantId") ?? ""),
      "error",
      toFormErrorMessage(parsed.error, { locale: submittedLocale })
    );
    redirect(errorPath);
  }

  const { emailNotificationsEnabled, locale, tenantId } = parsed.data;
  const accessToken = await requirePublicSession(
    locale,
    NOTIFICATION_SETTINGS_RETURN_TO,
    tenantId
  );
  const updated = await withPublicSessionReauth(
    locale,
    NOTIFICATION_SETTINGS_RETURN_TO,
    () =>
      updateNotificationSettings(
        tenantId,
        emailNotificationsEnabled,
        accessToken
      ),
    tenantId
  );
  if (!updated) {
    const errorPath = await buildSettingsPath(
      locale,
      tenantId,
      "error",
      getMessage(messages, "host.settings.email_notifications_update_failed")
    );
    redirect(errorPath);
  }

  const successPath = await buildSettingsPath(
    locale,
    tenantId,
    "success",
    getMessage(messages, "host.settings.email_notifications_updated")
  );
  redirect(successPath);
};
