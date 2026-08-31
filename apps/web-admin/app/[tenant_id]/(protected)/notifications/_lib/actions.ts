"use server";

import { getMessage } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { z } from "zod";

import { getActionLocale } from "#lib/action-messages";
import { withAdminSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import {
  markAllNotificationsAsRead,
  markNotificationAsRead,
  notificationsCacheTag,
} from "#lib/notification";

import type { MarkNotificationActionState } from "../notification-types";

const tenantIdSchema = z.string().trim().min(1);

const markOneSchema = z.object({
  notificationId: z.string().trim().pipe(z.uuid()),
  tenantId: tenantIdSchema,
});

const markAllSchema = z.object({
  tenantId: tenantIdSchema,
});

export const markNotificationAsReadAction = async (
  _prevState: MarkNotificationActionState,
  formData: FormData
): Promise<MarkNotificationActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const messages = sharedCatalog(locale);
  const parsed = markOneSchema.safeParse(
    toFormDataInput(formData, {
      notificationId: { kind: "value", name: "notification_id" },
      tenantId: { kind: "value", name: "tenant_id" },
    })
  );
  if (!parsed.success) {
    return {
      message: getMessage(messages, "errors.validation"),
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
    markNotificationAsRead(parsed.data, locale)
  );
  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
    };
  }

  updateTag(notificationsCacheTag(parsed.data.tenantId));
  return {
    message: getMessage(messages, "admin.notifications.mark_read_success"),
    ok: true,
  };
};

export const markAllNotificationsAsReadAction = async (
  _prevState: MarkNotificationActionState,
  formData: FormData
): Promise<MarkNotificationActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const messages = sharedCatalog(locale);
  const parsed = markAllSchema.safeParse(
    toFormDataInput(formData, {
      tenantId: { kind: "value", name: "tenant_id" },
    })
  );
  if (!parsed.success) {
    return {
      message: getMessage(messages, "errors.validation"),
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
    markAllNotificationsAsRead(parsed.data.tenantId, locale)
  );
  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
    };
  }

  updateTag(notificationsCacheTag(parsed.data.tenantId));
  return {
    message: getMessage(messages, "admin.notifications.mark_all_read_success"),
    ok: true,
  };
};
