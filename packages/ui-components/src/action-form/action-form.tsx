"use client";

import type { FormActionState } from "@publira/utils/form-action";
import type { ReactNode } from "react";
import { useActionState } from "react";

import { Button } from "../button";
import type { ButtonProps } from "../button";
import { FormMessage } from "../form-message";

export type { FormActionState };

export interface ActionFormRenderProps {
  isPending: boolean;
  state: FormActionState;
}

export interface ActionFormProps {
  action: (
    prevState: FormActionState,
    formData: FormData
  ) => Promise<FormActionState>;
  children: ReactNode | ((props: ActionFormRenderProps) => ReactNode);
  className?: string;
  disabled?: boolean;
  pendingLabel?: string;
  showSuccess?: boolean;
  submitClassName?: string;
  submitLabel?: string;
  submitVariant?: ButtonProps["variant"];
}

export const ActionForm = ({
  action,
  children,
  className,
  disabled,
  pendingLabel,
  showSuccess = false,
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
