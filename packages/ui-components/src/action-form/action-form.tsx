"use client";

import type { ReactNode } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "../button/button";
import type { ButtonProps } from "../button/button";
import { FormMessage } from "../form-message";

/**
 * The state a Server Action returns.
 *
 * - `null` — the initial state, before the form is submitted
 * - `{ ok: true, message }` — success
 * - `{ ok: false, message }` — failure
 *
 * The Server Action can import the type too.
 *
 * ```ts
 * // _lib/actions.ts
 * "use server";
 * import type { FormActionState } from "@publira/ui-components/action-form";
 * ```
 */
export type FormActionState = { ok: boolean; message: string } | null;

export interface ActionFormRenderProps {
  isPending: boolean;
  state: FormActionState;
}

export interface ActionFormSubmitProps {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  variant?: ButtonProps["variant"];
}

/**
 * Submit control for Server Component form content.
 *
 * Keeping the label in `children` lets a server-rendered `<Message />` sit at
 * the point where it is displayed, while `useFormStatus` still disables the
 * control during its Server Action.
 */
export const ActionFormSubmit = ({
  children,
  className,
  disabled,
  variant,
}: ActionFormSubmitProps) => {
  const { pending } = useFormStatus();

  return (
    <Button
      className={className}
      disabled={disabled || pending}
      type="submit"
      variant={variant}
    >
      {children}
    </Button>
  );
};

/**
 * A form component that encapsulates `useActionState`.
 *
 * **Automatic mode** — pass a ReactNode as `children` and the returned message
 * and the submit button are managed for you:
 *
 * ```tsx
 * <ActionForm
 *   action={myAction}
 *   submitLabel="Save"
 *   pendingLabel="Saving..."
 * >
 *   <Field>...</Field>
 * </ActionForm>
 * ```
 *
 * **Render-function mode** — place the button and the message yourself:
 *
 * ```tsx
 * <ActionForm action={myAction}>
 *   {({ isPending, state }) => (
 *     <>
 *       <Field>...</Field>
 *       {state ? (
 *         <FormMessage variant={state.ok ? "success" : "destructive"}>
 *           {state.message}
 *         </FormMessage>
 *       ) : null}
 *       <Button disabled={isPending} type="submit">Save</Button>
 *     </>
 *   )}
 * </ActionForm>
 * ```
 */

export interface ActionFormProps {
  action: (
    prevState: FormActionState,
    formData: FormData
  ) => Promise<FormActionState>;
  children: ReactNode | ((props: ActionFormRenderProps) => ReactNode);
  className?: string;
  disabled?: boolean;
  pendingLabel?: ReactNode;
  /**
   * Show the message when the Action returns `{ ok: true }`. Defaults to true:
   * a returned success message is meant to be shown. Callers that redirect
   * never produce this state; pass `false` to suppress one.
   */
  showSuccess?: boolean;
  submitClassName?: string;
  submitLabel?: ReactNode;
  submitVariant?: ButtonProps["variant"];
}

export const ActionForm = ({
  action,
  children,
  className,
  disabled,
  pendingLabel,
  showSuccess = true,
  submitClassName,
  submitLabel,
  submitVariant,
}: ActionFormProps) => {
  const [state, formAction, isPending] = useActionState(action, null);

  if (typeof children === "function") {
    return (
      <form action={formAction} className={className}>
        {children({ isPending, state })}
      </form>
    );
  }

  return (
    <form action={formAction} className={className}>
      {children}

      {state && (showSuccess || !state.ok) ? (
        <FormMessage variant={state.ok ? "success" : "destructive"}>
          {state.message}
        </FormMessage>
      ) : null}

      {submitLabel ? (
        <Button
          className={submitClassName}
          disabled={isPending || disabled}
          type="submit"
          variant={submitVariant}
        >
          {isPending ? (pendingLabel ?? submitLabel) : submitLabel}
        </Button>
      ) : null}
    </form>
  );
};
