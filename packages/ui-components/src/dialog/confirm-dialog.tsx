"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";
import { cn } from "@publira/utils";
import * as React from "react";

import { buttonVariants } from "../button";
import type { ButtonProps } from "../button";
import {
  DialogBackdrop,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogPortal,
  DialogTitle,
} from "./dialog";

export interface ConfirmDialogProps {
  trigger: React.ReactElement;
  title: React.ReactNode;
  description?: React.ReactNode;
  cancelText?: React.ReactNode;
  actionText?: React.ReactNode;
  actionVariant?: NonNullable<ButtonProps["variant"]>;
  onAction?: () => void;
}

export const ConfirmDialog = ({
  actionText = "実行",
  actionVariant = "destructive",
  cancelText = "キャンセル",
  description,
  onAction,
  title,
  trigger,
}: ConfirmDialogProps) => (
  <AlertDialog.Root>
    <AlertDialog.Trigger render={trigger} />
    <DialogPortal>
      <DialogBackdrop />
      <DialogPopup>
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
          {description ? (
            <DialogDescription className="text-sm text-muted-foreground">
              {description}
            </DialogDescription>
          ) : null}
        </DialogHeader>

        <DialogFooter>
          <AlertDialog.Close
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            {cancelText}
          </AlertDialog.Close>
          <AlertDialog.Close
            className={cn(buttonVariants({ variant: actionVariant }))}
            onClick={onAction}
          >
            {actionText}
          </AlertDialog.Close>
        </DialogFooter>
      </DialogPopup>
    </DialogPortal>
  </AlertDialog.Root>
);
