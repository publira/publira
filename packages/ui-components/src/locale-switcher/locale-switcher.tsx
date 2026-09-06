"use client";

import { cn } from "@publira/utils";
import { createContext, useCallback, useContext, useMemo } from "react";
import type { ReactNode } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "../popover";

interface LocaleSwitcherContextValue {
  currentLocale: string;
  fieldName: string;
  submit: (formData: FormData) => Promise<void>;
}

const LocaleSwitcherContext = createContext<LocaleSwitcherContextValue | null>(
  null
);

const useLocaleSwitcher = (): LocaleSwitcherContextValue => {
  const value = useContext(LocaleSwitcherContext);
  if (!value) {
    throw new Error(
      "LocaleSwitcher slots must be rendered inside LocaleSwitcher."
    );
  }
  return value;
};

export interface LocaleSwitcherProps {
  action: (formData: FormData) => Promise<void>;
  children: ReactNode;
  currentLocale: string;
  fieldName: string;
}

/**
 * A compact display-language control for a header.
 *
 * Applications own locale persistence and the language names; this component
 * owns the keyboard-accessible popover and updates the document language only
 * after that persistence Action succeeds.
 *
 * Composed rather than prop-driven, so each language name is written on the
 * button that offers it and the accessible name of the trigger is an ordinary
 * `aria-label`.
 *
 * ```tsx
 * <LocaleSwitcher
 *   action={setLocaleAction}
 *   currentLocale={locale}
 *   fieldName="locale"
 * >
 *   <LocaleSwitcherTrigger aria-label="Language: English">
 *     English
 *   </LocaleSwitcherTrigger>
 *   <LocaleSwitcherContent>
 *     <LocaleSwitcherTitle>Language</LocaleSwitcherTitle>
 *     <LocaleSwitcherOptions aria-label="Language">
 *       <LocaleSwitcherOption locale="en">English</LocaleSwitcherOption>
 *       <LocaleSwitcherOption locale="ja">日本語</LocaleSwitcherOption>
 *     </LocaleSwitcherOptions>
 *   </LocaleSwitcherContent>
 * </LocaleSwitcher>
 * ```
 */
export const LocaleSwitcher = ({
  action,
  children,
  currentLocale,
  fieldName,
}: LocaleSwitcherProps) => {
  const submit = useCallback(
    async (formData: FormData) => {
      await action(formData);

      // The value comes from one of this form's own option buttons, so it is
      // already one of the locales the caller offered.
      const chosenLocale = formData.get(fieldName);
      if (typeof chosenLocale === "string") {
        document.documentElement.lang = chosenLocale;
      }
    },
    [action, fieldName]
  );

  const value = useMemo(
    () => ({ currentLocale, fieldName, submit }),
    [currentLocale, fieldName, submit]
  );

  return (
    <LocaleSwitcherContext value={value}>
      <Popover>{children}</Popover>
    </LocaleSwitcherContext>
  );
};

export const LocaleSwitcherTrigger = ({
  "aria-label": ariaLabel,
  children,
}: {
  /** Names the control and the language it currently shows. */
  "aria-label": string;
  children: ReactNode;
}) => (
  <PopoverTrigger
    aria-label={ariaLabel}
    className="inline-flex h-9 max-w-28 items-center rounded-full border border-border/70 bg-card px-3 text-sm font-medium text-foreground transition-colors hover:border-border hover:bg-muted data-popup-open:bg-muted"
  >
    <span className="truncate">{children}</span>
  </PopoverTrigger>
);

export const LocaleSwitcherContent = ({
  children,
}: {
  children: ReactNode;
}) => (
  <PopoverContent align="end" className="w-48" sideOffset={8}>
    {children}
  </PopoverContent>
);

export const LocaleSwitcherTitle = ({ children }: { children: ReactNode }) => (
  <PopoverTitle className="px-2 py-1.5 text-sm font-medium text-foreground">
    {children}
  </PopoverTitle>
);

export const LocaleSwitcherOptions = ({
  "aria-label": ariaLabel,
  children,
}: {
  /** Names the list of languages for a screen reader. */
  "aria-label": string;
  children: ReactNode;
}) => {
  const { submit } = useLocaleSwitcher();

  return (
    <form action={submit} aria-label={ariaLabel} className="grid gap-0.5">
      {children}
    </form>
  );
};

export const LocaleSwitcherOption = ({
  children,
  locale,
}: {
  children: ReactNode;
  locale: string;
}) => {
  const { currentLocale, fieldName } = useLocaleSwitcher();
  const isCurrent = locale === currentLocale;

  return (
    <button
      aria-current={isCurrent ? "true" : undefined}
      className={cn(
        "flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm outline-hidden transition-colors hover:bg-muted focus-visible:bg-muted",
        isCurrent
          ? "bg-muted font-medium text-foreground"
          : "text-muted-foreground"
      )}
      lang={locale}
      name={fieldName}
      type="submit"
      value={locale}
    >
      {children}
    </button>
  );
};
