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
  idleLabel,
  notificationId,
  pendingLabel,
}: {
  ariaLabel: string;
  idleLabel: ReactNode;
  notificationId: string;
  pendingLabel: ReactNode;
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
        {isPending ? pendingLabel : idleLabel}
      </Button>
      {state && !state.ok ? (
        <FormMessage variant="destructive">{state.message}</FormMessage>
      ) : null}
    </form>
  );
};

export const MarkAllNotificationsAsReadButton = ({
  idleLabel,
  pendingLabel,
}: {
  idleLabel: ReactNode;
  pendingLabel: ReactNode;
}) => {
  const [state, formAction, isPending] = useActionState(
    markAllNotificationsAsReadAction,
    null
  );

  return (
    <form action={formAction} className="grid justify-items-end gap-1">
      <Button disabled={isPending} size="sm" type="submit" variant="outline">
        {isPending ? pendingLabel : idleLabel}
      </Button>
      {state && !state.ok ? (
        <FormMessage variant="destructive">{state.message}</FormMessage>
      ) : null}
    </form>
  );
};
