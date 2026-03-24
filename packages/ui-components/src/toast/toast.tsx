"use client";

import { Toast as BaseToast } from "@base-ui/react/toast";
import { cn } from "@publira/utils";
import type { ReactNode } from "react";

export const { useToastManager } = BaseToast;

export const ToastViewport = ({
  className,
  ...props
}: BaseToast.Viewport.Props) => (
  <BaseToast.Viewport
    {...props}
    className={cn(
      "pointer-events-none fixed right-4 bottom-4 z-[70] flex w-[min(92vw,24rem)] flex-col gap-2",
      className
    )}
  />
);

export const ToastRoot = ({ className, ...props }: BaseToast.Root.Props) => (
  <BaseToast.Root
    {...props}
    className={cn(
      "pointer-events-auto rounded-lg border bg-card px-4 py-3 text-card-foreground shadow-lg",
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
}: BaseToast.Content.Props) => (
  <BaseToast.Content {...props} className={cn("grid gap-1", className)} />
);

export const ToastTitle = ({ className, ...props }: BaseToast.Title.Props) => (
  <BaseToast.Title
    {...props}
    className={cn("text-sm font-semibold", className)}
  />
);

export const ToastDescription = ({
  className,
  ...props
}: BaseToast.Description.Props) => (
  <BaseToast.Description
    {...props}
    className={cn("text-xs opacity-90", className)}
  />
);

export const ToastClose = ({
  className,
  children = "\u00D7",
  ...props
}: BaseToast.Close.Props) => (
  <BaseToast.Close
    {...props}
    className={cn(
      "absolute top-2 right-2 flex size-5 items-center justify-center rounded text-current opacity-60 hover:opacity-100 focus-visible:outline focus-visible:outline-2",
      className
    )}
  >
    {children}
  </BaseToast.Close>
);

const ToastStack = () => {
  const { toasts } = useToastManager();
  return (
    <ToastViewport>
      {toasts.map((toast) => (
        <ToastRoot key={toast.id} toast={toast}>
          <ToastClose />
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
  limit?: number;
  timeout?: number;
}

export const ToastProvider = ({
  children,
  limit = 3,
  timeout = 4000,
}: ToastProviderProps) => (
  <BaseToast.Provider limit={limit} timeout={timeout}>
    {children}
    <ToastStack />
  </BaseToast.Provider>
);
