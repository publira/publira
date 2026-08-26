"use client";

import { Button } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import { useActionState } from "react";
import type { ReactNode } from "react";

import {
  markAllNotificationsAsReadAction,
  markNotificationAsReadAction,
} from "../_lib/actions";

export const MarkNotificationAsReadButton = ({
  ariaLabel,
  children,
  notificationId,
}: {
  ariaLabel: string;
  children: ReactNode;
  notificationId: string;
}) => {
  const [state, formAction, isPending] = useActionState(
    markNotificationAsReadAction,
    null
  );

  return (
    <form action={formAction} className="grid justify-items-end gap-1">
      <input name="notification_id" type="hidden" value={notificationId} />
      <Button
        aria-label={ariaLabel}
        disabled={isPending}
        size="sm"
        type="submit"
        variant="outline"
      >
        {children}
      </Button>
      {state && !state.ok ? (
        <FormMessage variant="destructive">{state.message}</FormMessage>
      ) : null}
    </form>
  );
};

export const MarkAllNotificationsAsReadButton = ({
  children,
}: {
  children: ReactNode;
}) => {
  const [state, formAction, isPending] = useActionState(
    markAllNotificationsAsReadAction,
    null
  );

  return (
    <form action={formAction} className="grid justify-items-end gap-1">
      <Button disabled={isPending} size="sm" type="submit" variant="outline">
        {children}
      </Button>
      {state && !state.ok ? (
        <FormMessage variant="destructive">{state.message}</FormMessage>
      ) : null}
    </form>
  );
};
