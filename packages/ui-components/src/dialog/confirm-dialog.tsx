"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";
import { cn } from "@publira/utils";
import type { ReactNode } from "react";

import { buttonVariants } from "../button/button";
import type { ButtonProps } from "../button/button";
import {
  DialogBackdrop,
  DialogDescription,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  DialogViewport,
} from "./dialog";

export {
  DialogFooter as ConfirmDialogFooter,
  DialogHeader as ConfirmDialogHeader,
} from "./dialog";

/**
 * A confirmation flow: a trigger, and a modal that asks before the destructive
 * thing happens.
 *
 * Composed rather than prop-driven, so the wording of the two footer buttons is
 * written on the buttons themselves instead of arriving through props named
 * after them.
 *
 * ```tsx
 * <ConfirmDialog>
 *   <ConfirmDialogTrigger
 *     render={<Button variant="destructive">Delete</Button>}
 *   />
 *   <ConfirmDialogContent>
 *     <ConfirmDialogHeader>
 *       <ConfirmDialogTitle>Delete this item?</ConfirmDialogTitle>
 *       <ConfirmDialogDescription>
 *         This cannot be undone.
 *       </ConfirmDialogDescription>
 *     </ConfirmDialogHeader>
 *     <ConfirmDialogFooter>
 *       <ConfirmDialogCancel>Cancel</ConfirmDialogCancel>
 *       <ConfirmDialogAction onClick={remove}>Delete</ConfirmDialogAction>
 *     </ConfirmDialogFooter>
 *   </ConfirmDialogContent>
 * </ConfirmDialog>
 * ```
 */
export const ConfirmDialog = ({ children }: { children: ReactNode }) => (
  <AlertDialog.Root>{children}</AlertDialog.Root>
);

export const ConfirmDialogTrigger = AlertDialog.Trigger;

export const ConfirmDialogContent = ({ children }: { children: ReactNode }) => (
  <DialogPortal>
    <DialogBackdrop />
    <DialogViewport>
      <DialogPopup>{children}</DialogPopup>
    </DialogViewport>
  </DialogPortal>
);

export const ConfirmDialogTitle = ({ children }: { children: ReactNode }) => (
  <DialogTitle className="text-lg font-semibold">{children}</DialogTitle>
);

export const ConfirmDialogDescription = ({
  children,
}: {
  children: ReactNode;
}) => (
  <DialogDescription className="text-sm text-muted-foreground">
    {children}
  </DialogDescription>
);

/** Dismisses the dialog and does nothing else. */
export const ConfirmDialogCancel = ({ children }: { children: ReactNode }) => (
  <AlertDialog.Close className={cn(buttonVariants({ variant: "outline" }))}>
    {children}
  </AlertDialog.Close>
);

/** Dismisses the dialog and runs the thing it asked about. */
export const ConfirmDialogAction = ({
  children,
  onClick,
  variant = "destructive",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: NonNullable<ButtonProps["variant"]>;
}) => (
  <AlertDialog.Close
    className={cn(buttonVariants({ variant }))}
    onClick={onClick}
  >
    {children}
  </AlertDialog.Close>
);
