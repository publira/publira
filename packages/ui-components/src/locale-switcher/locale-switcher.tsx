"use client";

import { cn } from "@publira/utils";
import { useCallback } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "../popover";

export interface LocaleSwitcherOption {
  label: string;
  locale: string;
}

export interface LocaleSwitcherProps {
  action: (formData: FormData) => Promise<void>;
  currentLocale: string;
  fieldName: string;
  label: string;
  options: readonly LocaleSwitcherOption[];
}

/**
 * A compact display-language control for a header.
 *
 * Applications own locale persistence and translated copy; this component owns
 * the common, keyboard-accessible popover and updates the document language
 * only after that persistence Action succeeds.
 */
export const LocaleSwitcher = ({
  action,
  currentLocale,
  fieldName,
  label,
  options,
}: LocaleSwitcherProps) => {
  const currentOption =
    options.find((option) => option.locale === currentLocale) ?? options[0];
  const submit = useCallback(
    async (formData: FormData) => {
      await action(formData);

      const chosenLocale = formData.get(fieldName);
      if (
        typeof chosenLocale === "string" &&
        options.some((option) => option.locale === chosenLocale)
      ) {
        document.documentElement.lang = chosenLocale;
      }
    },
    [action, fieldName, options]
  );

  if (!currentOption) {
    return null;
  }

  return (
    <Popover>
      <PopoverTrigger
        aria-label={`${label}: ${currentOption.label}`}
        className="inline-flex h-9 max-w-28 items-center rounded-full border border-border/70 bg-card px-3 text-sm font-medium text-foreground transition-colors hover:border-border hover:bg-muted data-popup-open:bg-muted"
      >
        <span className="truncate">{currentOption.label}</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48" sideOffset={8}>
        <PopoverTitle className="px-2 py-1.5 text-sm font-medium text-foreground">
          {label}
        </PopoverTitle>
        <form action={submit} aria-label={label} className="grid gap-0.5">
          {options.map((option) => {
            const isCurrent = option.locale === currentLocale;

            return (
              <button
                aria-current={isCurrent ? "true" : undefined}
                className={cn(
                  "flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm outline-hidden transition-colors hover:bg-muted focus-visible:bg-muted",
                  isCurrent
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground"
                )}
                key={option.locale}
                lang={option.locale}
                name={fieldName}
                type="submit"
                value={option.locale}
              >
                {option.label}
              </button>
            );
          })}
        </form>
      </PopoverContent>
    </Popover>
  );
};
