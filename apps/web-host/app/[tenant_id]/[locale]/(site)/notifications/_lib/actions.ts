"use server";

import { getMessage } from "@publira/i18n";
import { validationErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { z } from "zod";

import { tenantIdSchema } from "#lib/auth-input";
import {
  requirePublicSession,
  withPublicSessionReauth,
} from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { LOCALE_FIELD_NAME, localeFormSchema } from "#lib/locale-form";
import { loadHostMessages } from "#lib/messages";
import {
  markAllNotificationsAsRead,
  markNotificationAsRead,
  notificationsCacheTag,
} from "#lib/notification";

import type { MarkNotificationActionState } from "../notification-types";

const NOTIFICATIONS_RETURN_TO = "/notifications";

const markOneSchema = z.object({
  locale: localeFormSchema,
  notificationId: z.string().trim().pipe(z.uuid()),
  tenantId: tenantIdSchema,
});

const markAllSchema = z.object({
  locale: localeFormSchema,
  tenantId: tenantIdSchema,
});

export const markNotificationAsReadAction = async (
  _prevState: MarkNotificationActionState,
  formData: FormData
): Promise<MarkNotificationActionState> => {
  await assertSameOrigin();
  const parsed = markOneSchema.safeParse(
    toFormDataInput(formData, {
      locale: "value",
      notificationId: "value",
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    // The locale field parses on its own — it falls back rather than failing —
    // so the rejection can still be worded in the reader's language.
    return {
      message: validationErrorMessage(
        localeFormSchema.parse(formData.get(LOCALE_FIELD_NAME))
      ),
      ok: false,
    };
  }

  const { locale, tenantId, ...input } = parsed.data;
  await requirePublicSession(locale, NOTIFICATIONS_RETURN_TO, tenantId);
  const result = await withPublicSessionReauth(
    locale,
    NOTIFICATIONS_RETURN_TO,
    () => markNotificationAsRead({ locale, tenantId, ...input }),
    tenantId
  );
  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
    };
  }

  updateTag(notificationsCacheTag(parsed.data.tenantId));
  const messages = await loadHostMessages(locale);
  return {
    message: getMessage(messages, "host.notifications.marked_read"),
    ok: true,
  };
};

export const markAllNotificationsAsReadAction = async (
  _prevState: MarkNotificationActionState,
  formData: FormData
): Promise<MarkNotificationActionState> => {
  await assertSameOrigin();
  const parsed = markAllSchema.safeParse(
    toFormDataInput(formData, {
      locale: "value",
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    return {
      message: validationErrorMessage(
        localeFormSchema.parse(formData.get(LOCALE_FIELD_NAME))
      ),
      ok: false,
    };
  }

  const { locale, tenantId } = parsed.data;
  await requirePublicSession(locale, NOTIFICATIONS_RETURN_TO, tenantId);
  const result = await withPublicSessionReauth(
    locale,
    NOTIFICATIONS_RETURN_TO,
    () => markAllNotificationsAsRead(tenantId, locale),
    tenantId
  );
  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
    };
  }

  updateTag(notificationsCacheTag(parsed.data.tenantId));
  const messages = await loadHostMessages(locale);
  return {
    message: getMessage(messages, "host.notifications.marked_all_read"),
    ok: true,
  };
};
