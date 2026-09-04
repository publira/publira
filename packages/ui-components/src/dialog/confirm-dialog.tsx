"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";
import { cn } from "@publira/utils";
import type { ReactElement, ReactNode } from "react";

import { buttonVariants } from "../button/button";
import type { ButtonProps } from "../button/button";
import {
  DialogBackdrop,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  DialogViewport,
} from "./dialog";

export interface ConfirmDialogProps {
  trigger: ReactElement;
  title: ReactNode;
  description?: ReactNode;
  cancelText: ReactNode;
  actionText: ReactNode;
  actionVariant?: NonNullable<ButtonProps["variant"]>;
  onAction?: () => void;
}

export const ConfirmDialog = ({
  actionText,
  actionVariant = "destructive",
  cancelText,
  description,
  onAction,
  title,
  trigger,
}: ConfirmDialogProps) => (
  <AlertDialog.Root>
    <AlertDialog.Trigger render={trigger} />
    <DialogPortal>
      <DialogBackdrop />
      <DialogViewport>
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
      </DialogViewport>
    </DialogPortal>
  </AlertDialog.Root>
);
