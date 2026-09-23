"use client";

import { Field as BaseField } from "@base-ui/react/field";
import { cn } from "@publira/utils";
import type { ComponentPropsWithoutRef, ComponentPropsWithRef } from "react";
import {
  createContext,
  use,
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

interface FieldPopupTriggerContextValue {
  hasPopupTrigger: boolean;
  registerPopupTrigger?: () => () => void;
}

const FieldPopupTriggerContext = createContext<FieldPopupTriggerContextValue>({
  hasPopupTrigger: false,
});

export type FieldProps = BaseField.Root.Props;

export const Field = ({ className, ...props }: FieldProps) => {
  const [hasPopupTrigger, setHasPopupTrigger] = useState(false);
  const registerPopupTrigger = useCallback(() => {
    setHasPopupTrigger(true);
    return () => setHasPopupTrigger(false);
  }, []);
  const popupTrigger = useMemo(
    () => ({ hasPopupTrigger, registerPopupTrigger }),
    [hasPopupTrigger, registerPopupTrigger]
  );

  return (
    <FieldPopupTriggerContext value={popupTrigger}>
      <BaseField.Root {...props} className={cn("grid gap-2", className)} />
    </FieldPopupTriggerContext>
  );
};

export type FieldLabelProps = Omit<
  BaseField.Label.Props,
  "nativeLabel" | "render"
> & {
  required?: boolean;
};

export const FieldLabel = ({
  children,
  className,
  required,
  ...props
}: FieldLabelProps) => {
  const { hasPopupTrigger } = use(FieldPopupTriggerContext);

  return (
    <BaseField.Label
      {...props}
      className={cn("text-sm font-medium text-foreground", className)}
      nativeLabel={!hasPopupTrigger}
      render={hasPopupTrigger ? <div /> : undefined}
    >
      <span>{children}</span>
      {required ? <span className="ml-1 text-destructive">*</span> : null}
    </BaseField.Label>
  );
};

const unsubscribe = () => null;
const subscribeToNothing = () => unsubscribe;

export type FieldPopupTriggerProps = ComponentPropsWithRef<"button">;

/**
 * The popup trigger a control renders through Base UI's `render` prop, which
 * makes `FieldLabel` non-native so that a click on it does not open the popup.
 * Base UI publishes the label and description ids from effects, and React
 * leaves attributes as the server rendered them while hydrating, so the ARIA
 * references are held back until the render right after hydration.
 */
export const FieldPopupTrigger = ({
  "aria-describedby": ariaDescribedBy,
  "aria-labelledby": ariaLabelledBy,
  ref,
  ...props
}: FieldPopupTriggerProps) => {
  const { registerPopupTrigger } = use(FieldPopupTriggerContext);
  const hydrated = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false
  );
  const triggerRef = useCallback(
    (element: HTMLButtonElement) => {
      const unregister = registerPopupTrigger?.();
      if (typeof ref === "function") {
        const cleanup = ref(element);
        return () => {
          unregister?.();
          if (typeof cleanup === "function") {
            cleanup();
          } else {
            ref(null);
          }
        };
      }
      if (ref) {
        ref.current = element;
      }
      return () => {
        unregister?.();
        if (ref) {
          ref.current = null;
        }
      };
    },
    [ref, registerPopupTrigger]
  );

  return (
    <button
      {...props}
      aria-describedby={hydrated ? ariaDescribedBy : undefined}
      aria-labelledby={hydrated ? ariaLabelledBy : undefined}
      ref={triggerRef}
      type="button"
    />
  );
};

export type FieldContentProps = ComponentPropsWithoutRef<"div">;

export const FieldContent = ({ className, ...props }: FieldContentProps) => (
  <div {...props} className={cn("grid gap-2", className)} />
);

export type FieldDescriptionProps = BaseField.Description.Props;

export const FieldDescription = ({
  className,
  ...props
}: FieldDescriptionProps) => (
  <BaseField.Description
    {...props}
    className={cn("text-xs text-muted-foreground", className)}
  />
);

export type FieldErrorProps = BaseField.Error.Props;

export const FieldError = ({ className, ...props }: FieldErrorProps) => (
  <BaseField.Error
    {...props}
    className={cn("text-xs text-destructive", className)}
  />
);
