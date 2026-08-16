"use server";

import { VALIDATION_ERROR_MESSAGE } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { z } from "zod";

import { tenantIdFormSchema } from "#lib/auth-input";
import {
  requirePublicSession,
  withPublicSessionReauth,
} from "#lib/auth-session";
import {
  markAllNotificationsAsRead,
  markNotificationAsRead,
  notificationsCacheTag,
} from "#lib/notification";

import type { MarkNotificationActionState } from "../notification-types";

const NOTIFICATIONS_RETURN_TO = "/notifications";

const markOneSchema = z.object({
  notificationId: z.string().trim().pipe(z.uuid()),
  tenantId: tenantIdFormSchema,
});

const markAllSchema = z.object({
  tenantId: tenantIdFormSchema,
});

export const markNotificationAsReadAction = async (
  _prevState: MarkNotificationActionState,
  formData: FormData
): Promise<MarkNotificationActionState> => {
  const parsed = markOneSchema.safeParse(
    toFormDataInput(formData, {
      notificationId: "value",
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    return {
      message: VALIDATION_ERROR_MESSAGE,
      ok: false,
    };
  }

  await requirePublicSession(NOTIFICATIONS_RETURN_TO);
  const result = await withPublicSessionReauth(NOTIFICATIONS_RETURN_TO, () =>
    markNotificationAsRead(parsed.data)
  );
  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
    };
  }

  updateTag(notificationsCacheTag(parsed.data.tenantId));
  return {
    message: "既読にしました。",
    ok: true,
  };
};

export const markAllNotificationsAsReadAction = async (
  _prevState: MarkNotificationActionState,
  formData: FormData
): Promise<MarkNotificationActionState> => {
  const parsed = markAllSchema.safeParse(
    toFormDataInput(formData, {
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    return {
      message: VALIDATION_ERROR_MESSAGE,
      ok: false,
    };
  }

  await requirePublicSession(NOTIFICATIONS_RETURN_TO);
  const result = await withPublicSessionReauth(NOTIFICATIONS_RETURN_TO, () =>
    markAllNotificationsAsRead(parsed.data.tenantId)
  );
  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
    };
  }

  updateTag(notificationsCacheTag(parsed.data.tenantId));
  return {
    message: "未読をすべて既読にしました。",
    ok: true,
  };
};
