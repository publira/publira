"use server";

import { VALIDATION_ERROR_MESSAGE } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { z } from "zod";

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
  const parsed = markOneSchema.safeParse(
    toFormDataInput(formData, {
      notificationId: { kind: "value", name: "notification_id" },
    })
  );
  if (!parsed.success) {
    return {
      message: VALIDATION_ERROR_MESSAGE,
      ok: false,
    };
  }

  const result = await markNotificationAsRead(parsed.data);
  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
    };
  }

  updateTag(notificationsCacheTag);
  return {
    message: "既読にしました。",
    ok: true,
  };
};

export const markAllNotificationsAsReadAction = async (
  _prevState: MarkNotificationActionState,
  _formData: FormData
): Promise<MarkNotificationActionState> => {
  const result = await markAllNotificationsAsRead();
  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
    };
  }

  updateTag(notificationsCacheTag);
  return {
    message: "未読をすべて既読にしました。",
    ok: true,
  };
};
