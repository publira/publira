"use client";

import { FormMessage } from "@publira/ui-components/form-message";
import { useActionState } from "react";

import { LocaleField } from "#components/locale-field";

import {
  markAllNotificationsAsReadAction,
  markNotificationAsReadAction,
} from "../_lib/actions";

const actionButtonClassName =
  "inline-flex rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-60";

/**
 * Resolved strings rather than nodes: the label swaps while the Action is in
 * flight, and the `aria-label` names the notification it belongs to.
 */
interface MarkNotificationAsReadCopy {
  ariaLabel: string;
  pending: string;
  submit: string;
}

export const MarkNotificationAsReadButton = ({
  copy,
  notificationId,
  tenantId,
}: {
  copy: MarkNotificationAsReadCopy;
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
        aria-label={copy.ariaLabel}
        className={actionButtonClassName}
        disabled={isPending}
        type="submit"
      >
        {isPending ? copy.pending : copy.submit}
      </button>
      {state && !state.ok ? (
        <FormMessage variant="destructive">{state.message}</FormMessage>
      ) : null}
    </form>
  );
};

export const MarkAllNotificationsAsReadButton = ({
  copy,
  tenantId,
}: {
  copy: { pending: string; submit: string };
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
        {isPending ? copy.pending : copy.submit}
      </button>
      {state && !state.ok ? (
        <FormMessage variant="destructive">{state.message}</FormMessage>
      ) : null}
    </form>
  );
};
