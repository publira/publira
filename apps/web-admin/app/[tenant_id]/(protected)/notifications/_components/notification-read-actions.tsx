"use client";

import { getMessage } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { Button } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import { useActionState, useContext } from "react";

import { AdminLocaleContext } from "#components/admin-locale-context";

import {
  markAllNotificationsAsReadAction,
  markNotificationAsReadAction,
} from "../_lib/actions";

export const MarkNotificationAsReadButton = ({
  label,
  notificationId,
  tenantId,
}: {
  label: string;
  notificationId: string;
  tenantId: string;
}) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const messages = sharedCatalog(locale);
  const [state, formAction, isPending] = useActionState(
    markNotificationAsReadAction,
    null
  );

  return (
    <form action={formAction} className="grid justify-items-end gap-1">
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="notification_id" type="hidden" value={notificationId} />
      <Button
        aria-label={getMessage(messages, "admin.notifications.mark_read_aria", {
          label,
        })}
        disabled={isPending}
        size="sm"
        type="submit"
        variant="outline"
      >
        {isPending
          ? getMessage(messages, "admin.notifications.updating")
          : getMessage(messages, "admin.notifications.mark_read")}
      </Button>
      {state && !state.ok ? (
        <FormMessage variant="destructive">{state.message}</FormMessage>
      ) : null}
    </form>
  );
};

export const MarkAllNotificationsAsReadButton = ({
  tenantId,
}: {
  tenantId: string;
}) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const messages = sharedCatalog(locale);
  const [state, formAction, isPending] = useActionState(
    markAllNotificationsAsReadAction,
    null
  );

  return (
    <form action={formAction} className="grid justify-items-end gap-1">
      <input name="tenant_id" type="hidden" value={tenantId} />
      <Button disabled={isPending} size="sm" type="submit" variant="outline">
        {isPending
          ? getMessage(messages, "admin.notifications.updating")
          : getMessage(messages, "admin.notifications.mark_all_read")}
      </Button>
      {state && !state.ok ? (
        <FormMessage variant="destructive">{state.message}</FormMessage>
      ) : null}
    </form>
  );
};
