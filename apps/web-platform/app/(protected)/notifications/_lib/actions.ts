"use server";

import { getMessage } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { z } from "zod";

import { withPlatformSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { getPlatformLocale } from "#lib/locale";
import {
  markAllNotificationsAsRead,
  markNotificationAsRead,
  notificationsCacheTag,
} from "#lib/notification";

import type { MarkNotificationActionState } from "../notification-types";

const markOneSchema = z.object({
  notificationId: z.string().trim().pipe(z.uuid()),
});

export const markNotificationAsReadAction = async (
  _prevState: MarkNotificationActionState,
  formData: FormData
): Promise<MarkNotificationActionState> => {
  await assertSameOrigin();
  const locale = await getPlatformLocale();
  const messages = sharedCatalog(locale);
  const parsed = markOneSchema.safeParse(
    toFormDataInput(formData, {
      notificationId: { kind: "value", name: "notification_id" },
    })
  );
  if (!parsed.success) {
    return {
      message: getMessage(messages, "errors.validation"),
      ok: false,
    };
  }

  const result = await withPlatformSessionReauth(() =>
    markNotificationAsRead(parsed.data, locale)
  );
  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
    };
  }

  updateTag(notificationsCacheTag);
  return {
    message: getMessage(messages, "platform.notifications.mark_read_success"),
    ok: true,
  };
};

export const markAllNotificationsAsReadAction = async (
  _prevState: MarkNotificationActionState,
  _formData: FormData
): Promise<MarkNotificationActionState> => {
  await assertSameOrigin();
  const locale = await getPlatformLocale();
  const messages = sharedCatalog(locale);
  const result = await withPlatformSessionReauth(() =>
    markAllNotificationsAsRead(locale)
  );
  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
    };
  }

  updateTag(notificationsCacheTag);
  return {
    message: getMessage(
      messages,
      "platform.notifications.mark_all_read_success"
    ),
    ok: true,
  };
};
