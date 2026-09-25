"use client";

import {
  ActionFormIdle,
  ActionFormPending,
} from "@publira/ui-components/action-form";
import { FormMessage } from "@publira/ui-components/form-message";
import { useActionState } from "react";

import { ClientMessage } from "#components/client-message";
import { LocaleField } from "#components/locale-field";

import {
  markAllNotificationsAsReadAction,
  markNotificationAsReadAction,
} from "../_lib/actions";

const actionButtonClassName =
  "inline-flex rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-60";

/**
 * `aria-label` names the notification, so each row's control is told apart.
 */
export const MarkNotificationAsReadButton = ({
  "aria-label": ariaLabel,
  notificationId,
  tenantId,
}: {
  "aria-label": string;
  notificationId: string;
  tenantId: string;
}) => {
  const [state, formAction, isPending] = useActionState(
    markNotificationAsReadAction,
    null
  );

  return (
    <form action={formAction} className="grid justify-items-start gap-1">
      <LocaleField />
      <input name="tenantId" type="hidden" value={tenantId} />
      <input name="notificationId" type="hidden" value={notificationId} />
      <button
        aria-label={ariaLabel}
        className={actionButtonClassName}
        disabled={isPending}
        type="submit"
      >
        <ActionFormIdle>
          <ClientMessage message="host.common.mark_read" />
        </ActionFormIdle>
        <ActionFormPending>
          <ClientMessage message="host.common.updating" />
        </ActionFormPending>
      </button>
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
  const [state, formAction, isPending] = useActionState(
    markAllNotificationsAsReadAction,
    null
  );

  return (
    <form action={formAction} className="grid justify-items-end gap-1">
      <LocaleField />
      <input name="tenantId" type="hidden" value={tenantId} />
      <button
        className={actionButtonClassName}
        disabled={isPending}
        type="submit"
      >
        <ActionFormIdle>
          <ClientMessage message="host.common.mark_all_read" />
        </ActionFormIdle>
        <ActionFormPending>
          <ClientMessage message="host.common.updating" />
        </ActionFormPending>
      </button>
      {state && !state.ok ? (
        <FormMessage variant="destructive">{state.message}</FormMessage>
      ) : null}
    </form>
  );
};
