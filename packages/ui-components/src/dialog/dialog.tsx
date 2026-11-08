import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { cn } from "@publira/utils";
import type { ComponentPropsWithoutRef, JSX } from "react";

import { FLOATING_TRANSITION } from "../motion";

type DivProps = ComponentPropsWithoutRef<"div">;

export const Dialog: typeof BaseDialog.Root = BaseDialog.Root;
export const DialogTrigger: typeof BaseDialog.Trigger = BaseDialog.Trigger;
export const DialogPortal: typeof BaseDialog.Portal = BaseDialog.Portal;
export const DialogClose: typeof BaseDialog.Close = BaseDialog.Close;
export const DialogTitle: typeof BaseDialog.Title = BaseDialog.Title;

export const DialogDescription: typeof BaseDialog.Description =
  BaseDialog.Description;

export const DialogViewport: typeof BaseDialog.Viewport = BaseDialog.Viewport;

type BackdropStyle = BaseDialog.Backdrop.Props["style"];

/** Base UI's state-driven form of `style`, which a plain `<div>` cannot take. */
const isStyleFunction = (
  style: BackdropStyle
): style is Extract<BackdropStyle, (...args: never[]) => void> =>
  typeof style === "function";

export const DialogBackdrop = ({
  className,
  forceRender: _forceRender,
  render: _render,
  style,
  ...props
}: BaseDialog.Backdrop.Props): JSX.Element => (
  // NOTE:
  // We intentionally render a plain div backdrop instead of BaseDialog.Backdrop.
  // In this project setup, the Base UI backdrop has intermittently failed to appear
  // at runtime even when the dialog is open, which results in a transparent overlay.
  // Keep the overlay token-based so it follows shared brand/theme colors.
  <div
    aria-hidden="true"
    {...props}
    style={isStyleFunction(style) ? undefined : style}
    className={cn(
      "fixed inset-0 z-40 bg-foreground/20 backdrop-blur-xs",
      className
    )}
  />
);

export const DialogPopup = ({
  className,
  ...props
}: BaseDialog.Popup.Props): JSX.Element => (
  <BaseDialog.Popup
    {...props}
    className={cn(
      "fixed top-1/2 left-1/2 z-50 w-[min(92vw,32rem)] -translate-x-1/2 -translate-y-1/2 rounded-surface border border-border bg-card p-5 text-card-foreground shadow-floating",
      FLOATING_TRANSITION,
      className
    )}
  />
);

export const DialogHeader = ({
  className,
  ...props
}: DivProps): JSX.Element => (
  <div {...props} className={cn("grid gap-1.5", className)} />
);

export const DialogFooter = ({
  className,
  ...props
}: DivProps): JSX.Element => (
  <div
    {...props}
    className={cn(
      "mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
      className
    )}
  />
);
