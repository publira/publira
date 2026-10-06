"use client";

import { Input as BaseInput } from "@base-ui/react/input";
import { EyeIcon } from "@publira/icons/eye-icon";
import { EyeOffIcon } from "@publira/icons/eye-off-icon";
import { cn } from "@publira/utils";
import type {
  ComponentPropsWithoutRef,
  MouseEvent,
  ReactNode,
  RefObject,
} from "react";
import {
  createContext,
  use,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";

import { buttonVariants } from "../button/button";
import { inputClassName } from "../input/input";

interface PasswordInputContextValue {
  inputRef: RefObject<HTMLInputElement | null>;
  revealed: boolean;
  setRevealed: (revealed: boolean) => void;
}

const PasswordInputContext = createContext<PasswordInputContextValue | null>(
  null
);

const usePasswordInputContext = (caller: string) => {
  const context = use(PasswordInputContext);
  if (!context) {
    throw new Error(`${caller} must be rendered inside a PasswordInput.`);
  }

  return context;
};

/**
 * A password box with a control beside it that shows what was typed and masks
 * it again, so a mistyped password is caught before the form is sent rather
 * than by the error that comes back.
 *
 * ```tsx
 * <PasswordInput>
 *   <PasswordInputControl autoComplete="new-password" name="password" />
 *   <PasswordInputToggle>Show password</PasswordInputToggle>
 * </PasswordInput>
 * ```
 *
 * Every field starts masked and is revealed on its own, so the box that
 * confirms a new password never shows one the reader did not ask to see.
 */
export const PasswordInput = ({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [revealed, setRevealed] = useState(false);
  const context = useMemo(
    () => ({ inputRef, revealed, setRevealed }),
    [revealed]
  );

  return (
    <PasswordInputContext value={context}>
      <div {...props} className={cn("relative", className)} />
    </PasswordInputContext>
  );
};

export type PasswordInputControlProps = Omit<BaseInput.Props, "type">;

/**
 * The box itself. Its `type` belongs to the toggle, and everything else —
 * `name`, `autoComplete`, `required` — is the caller's and stays as given
 * whichever way the value is shown.
 */
export const PasswordInputControl = ({
  className,
  ...props
}: PasswordInputControlProps) => {
  const { inputRef, revealed, setRevealed } = usePasswordInputContext(
    "PasswordInputControl"
  );

  // A revealed value is masked again as its form is sent, so a browser that
  // keeps a history of what was typed into text boxes never files the
  // password there, and the screen the submission returns to starts masked.
  const ref = useCallback(
    (input: HTMLInputElement) => {
      inputRef.current = input;
      const { form } = input;
      const mask = () => setRevealed(false);
      form?.addEventListener("submit", mask);

      return () => {
        form?.removeEventListener("submit", mask);
        inputRef.current = null;
      };
    },
    [inputRef, setRevealed]
  );

  return (
    <BaseInput
      {...props}
      className={cn(inputClassName, className, "pr-11")}
      ref={ref}
      type={revealed ? "text" : "password"}
    />
  );
};

export interface PasswordInputToggleProps {
  /**
   * The control's accessible name, read by assistive technology alone since
   * the control shows only an eye. It names the revealing ("Show password")
   * whichever state the field is in: `aria-pressed` is what says whether the
   * password is shown, and a name that changed with it would announce the
   * state twice.
   */
  children: ReactNode;
}

/**
 * The control that shows and masks the value of the box beside it.
 *
 * A pointer press does not take focus from the box, so a person typing keeps
 * typing where they were, and a phone keeps its keyboard open. The caret and
 * the selection are put back a frame after the change of `type`: Chromium
 * moves them to the start of a focused box whose `type` changed under a
 * pointer press it was not allowed to take focus from, and does so after the
 * click has been handled, so a restore inside the handler is undone.
 */
export const PasswordInputToggle = ({ children }: PasswordInputToggleProps) => {
  const { inputRef, revealed, setRevealed } = usePasswordInputContext(
    "PasswordInputToggle"
  );

  const handleMouseDown = useCallback((event: MouseEvent) => {
    event.preventDefault();
  }, []);

  const handleClick = useCallback(() => {
    setRevealed(!revealed);

    const input = inputRef.current;
    const start = input?.selectionStart ?? null;
    const end = input?.selectionEnd ?? null;
    if (!input || start === null || end === null) {
      return;
    }
    const direction = input.selectionDirection ?? undefined;
    requestAnimationFrame(() => {
      input.setSelectionRange(start, end, direction);
    });
  }, [inputRef, revealed, setRevealed]);

  return (
    <button
      aria-pressed={revealed}
      className={cn(
        buttonVariants({ size: "icon", variant: "ghost" }),
        // A coarse pointer would grow the icon button past the box it sits
        // in, so there it fills the box's height and the 44px the box keeps
        // clear at its end instead.
        "absolute top-0.5 right-0.5 text-muted-foreground hover:text-foreground pointer-coarse:top-0 pointer-coarse:right-0 pointer-coarse:h-full pointer-coarse:w-11"
      )}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      type="button"
    >
      {revealed ? (
        <EyeOffIcon aria-hidden className="size-4" />
      ) : (
        <EyeIcon aria-hidden className="size-4" />
      )}
      <span className="sr-only">{children}</span>
    </button>
  );
};
