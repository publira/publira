"use server";

import { VALIDATION_ERROR_MESSAGE } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { z } from "zod";

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
  const parsed = markOneSchema.safeParse(
    toFormDataInput(formData, {
      notificationId: { kind: "value", name: "notification_id" },
      tenantId: { kind: "value", name: "tenant_id" },
    })
  );
  if (!parsed.success) {
    return {
      message: VALIDATION_ERROR_MESSAGE,
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
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
  await assertSameOrigin();
  const parsed = markAllSchema.safeParse(
    toFormDataInput(formData, {
      tenantId: { kind: "value", name: "tenant_id" },
    })
  );
  if (!parsed.success) {
    return {
      message: VALIDATION_ERROR_MESSAGE,
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
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
