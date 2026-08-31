"use server";

import { getMessage } from "@publira/i18n";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import { updateMe } from "#lib/auth";
import { tenantIdFormSchema } from "#lib/auth-input";
import {
  requirePublicSession,
  withPublicSessionReauth,
} from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { localeFormSchema, requireFormLocale } from "#lib/locale-form";
import { loadHostMessages } from "#lib/messages";
import type { HostMessages } from "#lib/messages";

import { buildSettingsPath } from "./settings-form";

const SETTINGS_RETURN_TO = "/settings";

const updateProfileFormSchema = (messages: HostMessages) => {
  const nameRequired = getMessage(messages, "host.settings.name_required");

  return z.object({
    locale: localeFormSchema,
    name: z
      .string({ error: nameRequired })
      .trim()
      .min(1, nameRequired)
      .max(100, getMessage(messages, "host.settings.name_too_long")),
    tenantId: tenantIdFormSchema(messages),
  });
};

export const updateProfileAction = async (
  formData: FormData
): Promise<void> => {
  await assertSameOrigin();
  // The locale field falls back rather than failing, so a rejected submission
  // is still worded in the reader's language.
  const submittedLocale = requireFormLocale(formData.get("locale"));
  const messages = await loadHostMessages(submittedLocale);
  const parsed = updateProfileFormSchema(messages).safeParse(
    toFormDataInput(formData, {
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

  const { locale, name, tenantId } = parsed.data;
  const accessToken = await requirePublicSession(
    locale,
    SETTINGS_RETURN_TO,
    tenantId
  );
  const updated = await withPublicSessionReauth(
    locale,
    SETTINGS_RETURN_TO,
    () => updateMe(tenantId, name, accessToken),
    tenantId
  );
  if (!updated) {
    const errorPath = await buildSettingsPath(
      locale,
      tenantId,
      "error",
      getMessage(messages, "host.settings.profile_update_failed")
    );
    redirect(errorPath);
  }

  const successPath = await buildSettingsPath(
    locale,
    tenantId,
    "success",
    getMessage(messages, "host.settings.profile_updated")
  );
  redirect(successPath);
};
