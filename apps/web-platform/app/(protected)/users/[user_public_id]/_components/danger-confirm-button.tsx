"use client";

import { Button } from "@publira/ui-components/button";
import type { ButtonProps } from "@publira/ui-components/button";
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
  ConfirmDialogTrigger,
} from "@publira/ui-components/dialog";
import { useCallback, useTransition } from "react";

interface DangerConfirmButtonProps<T> {
  actionArg: T;
  actionCreator: (arg: T) => Promise<void>;
  actionText: string;
  actionVariant?: NonNullable<ButtonProps["variant"]>;
  cancelText: string;
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
  cancelText,
  description,
  title,
  triggerLabel,
  triggerVariant = "destructive",
}: DangerConfirmButtonProps<string>) => {
  const [isPending, startTransition] = useTransition();

  const handleAction = useCallback(() => {
    startTransition(async () => {
      await actionCreator(actionArg);
    });
  }, [actionArg, actionCreator]);

  return (
    <ConfirmDialog>
      <ConfirmDialogTrigger
        render={
          <Button disabled={isPending} variant={triggerVariant}>
            {triggerLabel}
          </Button>
        }
      />
      <ConfirmDialogContent>
        <ConfirmDialogHeader>
          <ConfirmDialogTitle>{title}</ConfirmDialogTitle>
          {description ? (
            <ConfirmDialogDescription>{description}</ConfirmDialogDescription>
          ) : null}
        </ConfirmDialogHeader>
        <ConfirmDialogFooter>
          <ConfirmDialogCancel>{cancelText}</ConfirmDialogCancel>
          <ConfirmDialogAction onClick={handleAction} variant={actionVariant}>
            {actionText}
          </ConfirmDialogAction>
        </ConfirmDialogFooter>
      </ConfirmDialogContent>
    </ConfirmDialog>
  );
};
