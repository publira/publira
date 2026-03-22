"use client";

import { Button } from "@publira/ui-components/button";
import type { ButtonProps } from "@publira/ui-components/button";
import { ConfirmDialog } from "@publira/ui-components/dialog";
import * as React from "react";
import { useTransition } from "react";

interface DangerConfirmButtonProps<T> {
  actionArg: T;
  actionCreator: (arg: T) => Promise<void>;
  actionText: string;
  actionVariant?: NonNullable<ButtonProps["variant"]>;
  description?: string;
  title: string;
  triggerLabel: string;
  triggerVariant?: ButtonProps["variant"];
}

export const DangerConfirmButton = ({
  actionArg,
  actionCreator,
  actionText,
  actionVariant = "destructive",
  description,
  title,
  triggerLabel,
  triggerVariant = "destructive",
}: DangerConfirmButtonProps<string>) => {
  const [isPending, startTransition] = useTransition();

  const handleAction = React.useCallback(() => {
    startTransition(async () => {
      await actionCreator(actionArg);
    });
  }, [actionArg, actionCreator]);

  return (
    <ConfirmDialog
      actionText={actionText}
      actionVariant={actionVariant}
      description={description}
      onAction={handleAction}
      title={title}
      trigger={
        <Button disabled={isPending} variant={triggerVariant}>
          {triggerLabel}
        </Button>
      }
    />
  );
};
