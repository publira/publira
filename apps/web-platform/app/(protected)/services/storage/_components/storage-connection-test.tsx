"use client";

import { CheckIcon, CloseIcon } from "@publira/icons";
import {
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import { FormMessage } from "@publira/ui-components/form-message";
import { cn } from "@publira/utils";
import { useActionState } from "react";

import { ClientMessage, useClientMessages } from "#components/client-message";

import type { PlatformStorageTestState } from "../_lib/actions";

interface StorageConnectionTestProps {
  action: (
    prevState: PlatformStorageTestState,
    formData: FormData
  ) => Promise<PlatformStorageTestState>;
}

/**
 * Runs the connection test with whatever the surrounding settings form holds,
 * saved or not, as a second submission of that form.
 */
export const StorageConnectionTest = ({
  action,
}: StorageConnectionTestProps) => {
  const [state, dispatch] = useActionState(action, null);
  const t = useClientMessages();

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
        <ActionFormSubmit formAction={dispatch} variant="outline">
          <ActionFormIdle>
            <ClientMessage message="platform.storage.test.submit" />
          </ActionFormIdle>
          <ActionFormPending>
            <ClientMessage message="platform.storage.test.pending" />
          </ActionFormPending>
        </ActionFormSubmit>
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
