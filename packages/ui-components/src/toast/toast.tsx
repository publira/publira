"use client";

import { Toast as BaseToast } from "@base-ui/react/toast";
import { CloseIcon } from "@publira/icons/close-icon";
import { cn } from "@publira/utils";
import type { JSX, ReactElement, ReactNode } from "react";

import { FLOATING_FADE } from "../motion";

export const useToastManager: typeof BaseToast.useToastManager =
  BaseToast.useToastManager;

export const ToastViewport = ({
  className,
  ...props
}: BaseToast.Viewport.Props): JSX.Element => (
  <BaseToast.Viewport
    {...props}
    className={cn(
      "pointer-events-none fixed right-4 bottom-4 z-[70] flex w-[min(92vw,24rem)] flex-col gap-2",
      className
    )}
  />
);

export const ToastRoot = ({
  className,
  ...props
}: BaseToast.Root.Props): JSX.Element => (
  <BaseToast.Root
    {...props}
    className={cn(
      "pointer-events-auto rounded-surface border border-border bg-popover px-4 py-3 text-popover-foreground shadow-floating",
      FLOATING_FADE,
      props.toast?.type === "success" &&
        "border-success/40 bg-success/10 text-success",
      props.toast?.type === "destructive" &&
        "border-destructive/40 bg-destructive/10 text-destructive",
      className
    )}
  />
);

export const ToastContent = ({
  className,
  ...props
}: BaseToast.Content.Props): JSX.Element => (
  <BaseToast.Content {...props} className={cn("grid gap-1", className)} />
);

export const ToastTitle = ({
  className,
  ...props
}: BaseToast.Title.Props): JSX.Element => (
  <BaseToast.Title
    {...props}
    className={cn("text-sm font-semibold", className)}
  />
);

export const ToastDescription = ({
  className,
  ...props
}: BaseToast.Description.Props): JSX.Element => (
  <BaseToast.Description {...props} className={cn("text-xs", className)} />
);

interface ToastCloseProps extends BaseToast.Close.Props {
  /**
   * Names the button. Its default content is an icon, which a screen reader
   * does not announce, and the copy is the app's, in the reader's language.
   */
  "aria-label": string;
}

export const ToastClose = ({
  className,
  children,
  ...props
}: ToastCloseProps): JSX.Element => (
  <BaseToast.Close
    {...props}
    className={cn(
      "absolute top-2 right-2 flex size-5 items-center justify-center rounded-control text-muted-foreground transition-colors duration-state ease-state hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
      className
    )}
  >
    {children ?? <CloseIcon className="size-4" />}
  </BaseToast.Close>
);

const ToastStack = ({ close }: { close: ReactElement }) => {
  const { toasts } = useToastManager();

  return (
    <ToastViewport>
      {toasts.map((toast) => (
        <ToastRoot key={toast.id} toast={toast}>
          {close}
          <ToastContent>
            {toast.title ? <ToastTitle>{toast.title}</ToastTitle> : null}
            {toast.description ? (
              <ToastDescription>{toast.description}</ToastDescription>
            ) : null}
          </ToastContent>
        </ToastRoot>
      ))}
    </ToastViewport>
  );
};

interface ToastProviderProps {
  children: ReactNode;
  /**
   * The close control drawn in every toast, a `Toast.Close` carrying the app's
   * label for it.
   */
  close: ReactElement;
  limit?: number;
  timeout?: number;
}

export const ToastProvider = ({
  children,
  close,
  limit = 3,
  timeout = 4000,
}: ToastProviderProps): JSX.Element => (
  <BaseToast.Provider limit={limit} timeout={timeout}>
    {children}
    <ToastStack close={close} />
  </BaseToast.Provider>
);
