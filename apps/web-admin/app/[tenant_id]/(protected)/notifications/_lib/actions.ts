"use server";

import type { FormActionState } from "@publira/ui-components/action-form";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { z } from "zod";

import { getActionLocale } from "#lib/action-messages";
import { withAdminSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { getMessagesFor } from "#lib/messages";
import {
  markAllNotificationsAsRead,
  markNotificationAsRead,
  notificationsCacheTag,
} from "#lib/notification";

const tenantIdSchema = z.string().trim().min(1);

const markOneSchema = z.object({
  notificationId: z.string().trim().pipe(z.uuid()),
  tenantId: tenantIdSchema,
});

const markAllSchema = z.object({
  tenantId: tenantIdSchema,
});

export const markNotificationAsReadAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const t = await getMessagesFor(locale);
  const parsed = markOneSchema.safeParse(
    toFormDataInput(formData, {
      notificationId: { kind: "value", name: "notification_id" },
      tenantId: { kind: "value", name: "tenant_id" },
    })
  );
  if (!parsed.success) {
    return {
      message: t("errors.validation"),
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
  // The control unmounts once the item is read, so a success message would
  // never reach the screen.
  return { message: "", ok: true };
};

export const markAllNotificationsAsReadAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const t = await getMessagesFor(locale);
  const parsed = markAllSchema.safeParse(
    toFormDataInput(formData, {
      tenantId: { kind: "value", name: "tenant_id" },
    })
  );
  if (!parsed.success) {
    return {
      message: t("errors.validation"),
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
  return { message: "", ok: true };
};
