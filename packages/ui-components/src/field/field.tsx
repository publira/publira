"use client";

import { Field as BaseField } from "@base-ui/react/field";
import { cn } from "@publira/utils";
import type {
  ComponentPropsWithoutRef,
  ComponentPropsWithRef,
  JSX,
  RefCallback,
} from "react";
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

/**
 * Marks the surrounding `Field` invalid until the returned function is called,
 * for an error message shown from outside the field's own validation, such as
 * one a Server Action returned. `null` outside a `Field`.
 */
type FieldErrorRegistration = () => () => void;

const FieldErrorRegistrationContext =
  createContext<FieldErrorRegistration | null>(null);

/** How an error message inside a `Field` marks it invalid while it is shown. */
export const useFieldErrorRegistration = (): FieldErrorRegistration | null =>
  use(FieldErrorRegistrationContext);

export type FieldProps = BaseField.Root.Props;

export const Field = ({
  className,
  invalid,
  ...props
}: FieldProps): JSX.Element => {
  const [hasPopupTrigger, setHasPopupTrigger] = useState(false);
  const [errorCount, setErrorCount] = useState(0);

  const registerPopupTrigger = useCallback(() => {
    setHasPopupTrigger(true);

    return () => setHasPopupTrigger(false);
  }, []);

  const popupTrigger = useMemo(
    () => ({ hasPopupTrigger, registerPopupTrigger }),
    [hasPopupTrigger, registerPopupTrigger]
  );

  const registerError = useCallback(() => {
    setErrorCount((count) => count + 1);

    return () => setErrorCount((count) => count - 1);
  }, []);

  return (
    <FieldPopupTriggerContext value={popupTrigger}>
      <FieldErrorRegistrationContext value={registerError}>
        <BaseField.Root
          {...props}
          className={cn("grid content-start gap-2", className)}
          invalid={invalid === true || errorCount > 0}
        />
      </FieldErrorRegistrationContext>
    </FieldPopupTriggerContext>
  );
};

/**
 * `htmlFor` is omitted because Base UI renders a control's explicit `id` only
 * after hydration, so a label pointing at it is unassociated in the server HTML.
 */
export type FieldLabelProps = Omit<
  BaseField.Label.Props,
  "htmlFor" | "nativeLabel" | "render"
> & {
  required?: boolean;
};

export const FieldLabel = ({
  children,
  className,
  required,
  ...props
}: FieldLabelProps): JSX.Element => {
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
type TriggerRef = FieldPopupTriggerProps["ref"];

const isRefCallback = (
  ref: TriggerRef
): ref is RefCallback<HTMLButtonElement> => typeof ref === "function";

const isRefCleanup = (
  value: ReturnType<RefCallback<HTMLButtonElement>>
): value is () => void => typeof value === "function";

export const FieldPopupTrigger = ({
  "aria-describedby": ariaDescribedBy,
  "aria-labelledby": ariaLabelledBy,
  ref,
  ...props
}: FieldPopupTriggerProps): JSX.Element => {
  const { registerPopupTrigger } = use(FieldPopupTriggerContext);

  const hydrated = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false
  );

  const triggerRef = useCallback(
    (element: HTMLButtonElement) => {
      const unregister = registerPopupTrigger?.();

      if (isRefCallback(ref)) {
        const cleanup = ref(element);

        return () => {
          unregister?.();

          if (isRefCleanup(cleanup)) {
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

export const FieldContent = ({
  className,
  ...props
}: FieldContentProps): JSX.Element => (
  <div {...props} className={cn("grid gap-2", className)} />
);

export type FieldDescriptionProps = BaseField.Description.Props;

export const FieldDescription = ({
  className,
  ...props
}: FieldDescriptionProps): JSX.Element => (
  <BaseField.Description
    {...props}
    className={cn("text-xs text-muted-foreground", className)}
  />
);

export type FieldErrorProps = BaseField.Error.Props;

export const FieldError = ({
  className,
  ...props
}: FieldErrorProps): JSX.Element => (
  <BaseField.Error
    {...props}
    className={cn("text-xs text-destructive", className)}
  />
);
