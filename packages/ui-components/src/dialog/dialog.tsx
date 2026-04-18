"use client";

import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { cn } from "@publira/utils";
import * as React from "react";

type DivProps = React.ComponentPropsWithoutRef<"div">;

export const Dialog = BaseDialog.Root;
export const DialogTrigger = BaseDialog.Trigger;
export const DialogPortal = BaseDialog.Portal;
export const DialogClose = BaseDialog.Close;
export const DialogTitle = BaseDialog.Title;
export const DialogDescription = BaseDialog.Description;
export const DialogViewport = BaseDialog.Viewport;

export const DialogBackdrop = ({
  className,
  forceRender: _forceRender,
  render: _render,
  style,
  ...props
}: BaseDialog.Backdrop.Props) => (
  // NOTE:
  // We intentionally render a plain div backdrop instead of BaseDialog.Backdrop.
  // In this project setup, the Base UI backdrop has intermittently failed to appear
  // at runtime even when the dialog is open, which results in a transparent overlay.
  // Keep the overlay token-based so it follows shared brand/theme colors.
  <div
    aria-hidden="true"
    {...props}
    style={typeof style === "function" ? undefined : style}
    className={cn(
      "fixed inset-0 z-40 bg-foreground/20 backdrop-blur-xs",
      className
    )}
  />
);

export const DialogPopup = ({
  className,
  ...props
}: BaseDialog.Popup.Props) => (
  <BaseDialog.Popup
    {...props}
    className={cn(
      "fixed top-1/2 left-1/2 z-50 w-[min(92vw,32rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-5 text-card-foreground shadow-lg",
      className
    )}
  />
);

export const DialogHeader = ({ className, ...props }: DivProps) => (
  <div {...props} className={cn("grid gap-1.5", className)} />
);

export const DialogFooter = ({ className, ...props }: DivProps) => (
  <div
    {...props}
    className={cn(
      "mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
      className
    )}
  />
);
