"use client";

import type { ReactNode, SubmitEvent } from "react";
import {
  createContext,
  startTransition,
  useActionState,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { requestFormReset, useFormStatus } from "react-dom";

import { Button } from "../button/button";
import type { ButtonProps } from "../button/button";
import { Fieldset } from "../fieldset/fieldset";
import type { FieldsetProps } from "../fieldset/fieldset";
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

/** An Action a submit control sends the form's fields to in place of the form's own. */
export type ActionFormControlAction = (formData: FormData) => void;

interface ActionFormContextValue {
  /** Where the submission in flight went: a control's own Action, or `null` for the form's. */
  submittedTo: ActionFormControlAction | null;
  submitTo: (action: ActionFormControlAction) => void;
}

const ActionFormContext = createContext<ActionFormContextValue | null>(null);

/** The Action of the control a slot sits in, `null` for the form's own. */
const ActionFormControlContext = createContext<ActionFormControlAction | null>(
  null
);

/**
 * Whether the submission in flight is the one the surrounding control started.
 * A plain `<form>` reports the Action it is running; outside a control with a
 * `formAction` of its own, any submission of that form counts.
 */
const useOwnSubmissionPending = () => {
  const { action, pending } = useFormStatus();
  const form = useContext(ActionFormContext);
  const control = useContext(ActionFormControlContext);
  if (!pending) {
    return false;
  }
  if (form) {
    return form.submittedTo === control;
  }

  return control === null || action === control;
};

export interface ActionFormSubmitProps {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  /** The id of the form a control rendered outside it submits, such as one in a dialog. */
  form?: string;
  /**
   * The caller's own Action for this control to send the form's fields to in
   * place of the form's, such as a connection test beside a save. Inside an
   * `ActionForm` the form keeps what it holds afterwards, and the control is
   * not the form's default button, so Enter in a field still submits to the
   * form's own Action. In a plain `<form>` it is the button's `formAction`.
   */
  formAction?: ActionFormControlAction;
  variant?: ButtonProps["variant"];
}

/**
 * Submit control for the form's content.
 *
 * Keeping the label in `children` lets a server-rendered `<Message />` sit at
 * the point where it is displayed, while `useFormStatus` still disables the
 * control during its Server Action. Wording that changes while the submission
 * is in flight goes in `ActionFormIdle` / `ActionFormPending`.
 */
export const ActionFormSubmit = ({
  children,
  className,
  disabled,
  form: formId,
  formAction,
  variant,
}: ActionFormSubmitProps) => {
  const { pending } = useFormStatus();
  const form = useContext(ActionFormContext);
  const submitsThroughActionForm = form !== null && formAction !== undefined;

  return (
    <ActionFormControlContext value={formAction ?? null}>
      <Button
        className={className}
        disabled={disabled || pending}
        form={formId}
        formAction={submitsThroughActionForm ? undefined : formAction}
        onClick={
          submitsThroughActionForm
            ? () => {
                form.submitTo(formAction);
              }
            : undefined
        }
        type={submitsThroughActionForm ? "button" : "submit"}
        variant={variant}
      >
        {children}
      </Button>
    </ActionFormControlContext>
  );
};

/**
 * The fields the form submits, closed while its Action is in flight: the
 * Action carries what they held when the form was submitted, so an edit made
 * meanwhile would sit under the result unsaved.
 */
export const ActionFormFieldset = ({ disabled, ...props }: FieldsetProps) => {
  const { pending } = useFormStatus();

  return <Fieldset {...props} disabled={disabled || pending} />;
};

/**
 * Renders its children except while the surrounding control's submission is in
 * flight. Outside an `ActionFormSubmit` given a `formAction`, that is the
 * submission to the form's own Action.
 */
export const ActionFormIdle = ({ children }: { children: ReactNode }) =>
  useOwnSubmissionPending() ? null : children;

/** Renders its children only while the surrounding control's submission is in flight. */
export const ActionFormPending = ({ children }: { children: ReactNode }) =>
  useOwnSubmissionPending() ? children : null;

/**
 * A form component that encapsulates `useActionState`.
 *
 * **Node mode** — pass a ReactNode as `children`. The message the Action
 * returns is rendered for you; the submit control is one of the children, so
 * its wording and its classes sit on the element itself:
 *
 * ```tsx
 * <ActionForm action={myAction}>
 *   <Field>...</Field>
 *   <ActionFormSubmit className="w-full">
 *     <ActionFormIdle>Save</ActionFormIdle>
 *     <ActionFormPending>Saving...</ActionFormPending>
 *   </ActionFormSubmit>
 * </ActionForm>
 * ```
 *
 * **Render-function mode** — place the message yourself, and read the state
 * the Action returned:
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
  /**
   * The `<form>`'s id, for a submit control outside it to name with `form` —
   * the confirm button of a dialog, which portals out of the form.
   */
  id?: string;
  /**
   * Show the message when the Action returns `{ ok: true }`. Defaults to true:
   * a returned success message is meant to be shown. Callers that redirect
   * never produce this state; pass `false` to suppress one.
   */
  showSuccess?: boolean;
}

export const ActionForm = ({
  action,
  children,
  className,
  id,
  showSuccess = true,
}: ActionFormProps) => {
  const formRef = useRef<HTMLFormElement>(null);
  const controlActionRef = useRef<ActionFormControlAction | null>(null);
  const [submittedTo, setSubmittedTo] =
    useState<ActionFormControlAction | null>(null);
  const [state, formAction, isPending] = useActionState(
    async (prevState: FormActionState, formData: FormData) => {
      const nextState = await action(prevState, formData);
      const form = formRef.current;
      if (nextState?.ok && form) {
        startTransition(() => {
          requestFormReset(form);
        });
      }
      return nextState;
    },
    null
  );

  // React resets a form whose `action` is a function as soon as it is
  // submitted, so the Action runs from here and the fields are reset above only
  // when it succeeds; a refused submission keeps what was typed.
  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const controlAction = controlActionRef.current;
    controlActionRef.current = null;
    const formData = new FormData(
      event.currentTarget,
      event.nativeEvent.submitter
    );
    setSubmittedTo(() => controlAction);
    startTransition(() => {
      if (controlAction) {
        controlAction(formData);
      } else {
        formAction(formData);
      }
    });
  };

  // `requestSubmit` dispatches the submit event before it returns, so the
  // Action is read by `handleSubmit` above or, when validation stops the
  // submission, cleared here.
  const submitTo = useCallback((controlAction: ActionFormControlAction) => {
    controlActionRef.current = controlAction;
    formRef.current?.requestSubmit();
    controlActionRef.current = null;
  }, []);

  const context = useMemo(
    () => ({ submitTo, submittedTo }),
    [submitTo, submittedTo]
  );

  return (
    <ActionFormContext value={context}>
      <form
        action={formAction}
        className={className}
        id={id}
        onSubmit={handleSubmit}
        ref={formRef}
      >
        {typeof children === "function" ? (
          children({ isPending, state })
        ) : (
          <>
            {children}

            {state && (showSuccess || !state.ok) ? (
              <FormMessage variant={state.ok ? "success" : "destructive"}>
                {state.message}
              </FormMessage>
            ) : null}
          </>
        )}
      </form>
    </ActionFormContext>
  );
};
