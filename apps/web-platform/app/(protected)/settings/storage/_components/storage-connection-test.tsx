"use client";

import { CheckIcon, CloseIcon } from "@publira/icons";
import { Button } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import { cn } from "@publira/utils";
import type { MouseEvent } from "react";
import { startTransition, useActionState, useCallback } from "react";

import { ClientMessage, useClientMessages } from "#components/client-message";

import type { PlatformStorageTestState } from "../../_lib/storage-actions";

interface StorageConnectionTestProps {
  action: (
    prevState: PlatformStorageTestState,
    formData: FormData
  ) => Promise<PlatformStorageTestState>;
}

/**
 * Runs the connection test with whatever the surrounding form holds, saved or
 * not. The Action is dispatched from the click rather than as the button's
 * `formAction`, because React resets a form once a form Action settles, and a
 * test is not a reason to wipe the values the operator is about to save.
 */
export const StorageConnectionTest = ({
  action,
}: StorageConnectionTestProps) => {
  const [state, dispatch, isPending] = useActionState(action, null);
  const t = useClientMessages();

  const handleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const { form } = event.currentTarget;
      if (!form) {
        return;
      }
      const formData = new FormData(form);
      startTransition(() => {
        dispatch(formData);
      });
    },
    [dispatch]
  );

  return (
    <div className="grid gap-3 rounded-control border border-border p-4">
      <div className="grid gap-1">
        <p className="text-sm font-medium text-foreground">
          <ClientMessage message="platform.storage.test.title" />
        </p>
        <p className="text-xs text-muted-foreground">
          <ClientMessage message="platform.storage.test.description" />
        </p>
      </div>
      <div>
        <Button
          disabled={isPending}
          onClick={handleClick}
          type="button"
          variant="outline"
        >
          {isPending ? (
            <ClientMessage message="platform.storage.test.pending" />
          ) : (
            <ClientMessage message="platform.storage.test.submit" />
          )}
        </Button>
      </div>
      {state ? (
        <FormMessage variant={state.ok ? "success" : "destructive"}>
          {state.message}
        </FormMessage>
      ) : null}
      {state?.checks ? (
        <ol
          aria-label={t("platform.storage.test.steps")}
          className="grid gap-2 text-sm"
        >
          {state.checks.map((check) => (
            <li className="flex items-start gap-2" key={check.label}>
              <span
                className={cn(
                  "mt-0.5 inline-flex size-4 shrink-0 items-center justify-center",
                  check.status === "succeeded" && "text-success",
                  check.status === "failed" && "text-destructive",
                  check.status === "skipped" && "text-muted-foreground"
                )}
              >
                {check.status === "succeeded" ? (
                  <CheckIcon aria-hidden className="size-4" />
                ) : null}
                {check.status === "failed" ? (
                  <CloseIcon aria-hidden className="size-4" />
                ) : null}
                {check.status === "skipped" ? <span aria-hidden>–</span> : null}
              </span>
              <span className="grid gap-0.5">
                <span className="font-medium text-foreground">
                  {check.label}
                  {": "}
                  {check.status === "succeeded" ? (
                    <ClientMessage message="platform.storage.test.status.succeeded" />
                  ) : null}
                  {check.status === "failed" ? (
                    <ClientMessage message="platform.storage.test.status.failed" />
                  ) : null}
                  {check.status === "skipped" ? (
                    <ClientMessage message="platform.storage.test.status.skipped" />
                  ) : null}
                </span>
                {check.detail ? (
                  <span className="text-xs text-muted-foreground">
                    {check.detail}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
};
