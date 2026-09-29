"use client";

import { CheckIcon } from "@publira/icons/check-icon";
import { CopyIcon } from "@publira/icons/copy-icon";
import { cn } from "@publira/utils";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { useCallback, useState } from "react";

import { buttonVariants } from "../button/button";

/** Long enough to be noticed, short enough not to outlast the glance. */
const COPIED_FEEDBACK_MS = 1500;

/**
 * A public id, a ticket code, or any other value an operator reads off a
 * detail screen and pastes somewhere else.
 *
 * Set in the sans face with tabular figures rather than in a monospace one: a
 * console has one typeface for its data, and a second face for a handful of
 * identifiers reads as a different kind of value rather than as a precise one.
 * What the monospace face was buying — digits that line up — is what
 * `tabular-nums` gives, and the exactness an operator actually needs comes
 * from {@link IdentifierCopy} instead of from the shape of the glyphs.
 *
 * ```tsx
 * <Identifier>
 *   <IdentifierValue>{user.publicId}</IdentifierValue>
 *   <IdentifierCopy aria-label="Copy the public ID" value={user.publicId} />
 * </Identifier>
 * ```
 */
export const Identifier = ({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) => (
  <div {...props} className={cn("flex items-center gap-1.5", className)} />
);

export const IdentifierValue = ({ children }: { children: ReactNode }) => (
  <span className="min-w-0 text-sm wrap-break-word text-foreground tabular-nums">
    {children}
  </span>
);

export interface IdentifierCopyProps {
  /** Names what is being copied, since the control is an icon on its own. */
  "aria-label": string;
  /** The exact text the clipboard receives. */
  value: string;
}

/**
 * Copies the identifier beside it.
 *
 * The confirmation is the icon turning into a check for a moment rather than a
 * message: nothing else on the screen changed, and a person who clicks a copy
 * control is already looking at it.
 *
 * A browser that refuses the clipboard — an insecure origin, a denied
 * permission — leaves the icon as it was, which is the honest answer: the
 * value is still selectable in the text next to it.
 */
export const IdentifierCopy = ({
  "aria-label": ariaLabel,
  value,
}: IdentifierCopyProps) => {
  const [copied, setCopied] = useState(false);

  const handleClick = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      setCopied(false);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
  }, [value]);

  return (
    <button
      aria-label={ariaLabel}
      className={cn(
        buttonVariants({ size: "icon", variant: "ghost" }),
        "size-7"
      )}
      onClick={handleClick}
      type="button"
    >
      {copied ? (
        <CheckIcon aria-hidden className="size-4" />
      ) : (
        <CopyIcon aria-hidden className="size-4" />
      )}
    </button>
  );
};
