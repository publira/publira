"use client";

import { FormMessage } from "@publira/ui-components/form-message";
import { useActionState } from "react";

import {
  markAllNotificationsAsReadAction,
  markNotificationAsReadAction,
} from "../_lib/actions";

const actionButtonClassName =
  "inline-flex rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-60";

export const MarkNotificationAsReadButton = ({
  label,
  notificationId,
  tenantId,
}: {
  label: string;
  notificationId: string;
  tenantId: string;
}) => {
  const [state, formAction, isPending] = useActionState(
    markNotificationAsReadAction,
    null
  );

  return (
    <form action={formAction} className="grid justify-items-start gap-1">
      <input name="tenantId" type="hidden" value={tenantId} />
      <input name="notificationId" type="hidden" value={notificationId} />
      <button
        aria-label={`${label}を既読にする`}
        className={actionButtonClassName}
        disabled={isPending}
        type="submit"
      >
        {isPending ? "更新中…" : "既読にする"}
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
      <input name="tenantId" type="hidden" value={tenantId} />
      <button
        className={actionButtonClassName}
        disabled={isPending}
        type="submit"
      >
        {isPending ? "更新中…" : "すべて既読にする"}
      </button>
      {state && !state.ok ? (
        <FormMessage variant="destructive">{state.message}</FormMessage>
      ) : null}
    </form>
  );
};
