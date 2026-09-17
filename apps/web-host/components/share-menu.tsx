"use client";

import { ShareIcon } from "@publira/icons/share-icon";
import { buttonVariants } from "@publira/ui-components/button";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@publira/ui-components/popover";
import { cn } from "@publira/utils";
import { useState } from "react";

import { useClientMessages } from "./client-message";

/** The composer each service opens with the link and the message filled in. */
const X_INTENT_URL = "https://x.com/intent/post";
const LINE_SHARE_URL = "https://social-plugins.line.me/lineit/share";

const withShareParams = (base: string, text: string, url: string): string => {
  const target = new URL(base);
  target.searchParams.set("text", text);
  target.searchParams.set("url", url);

  return target.toString();
};

/** How the copy control reports what happened, or nothing until it is used. */
type CopyOutcome = "copied" | "failed" | null;

const SHARE_ROW = cn(
  "flex items-center gap-2 rounded-control px-3 py-2 text-left text-sm text-muted-foreground transition-colors duration-state ease-state hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:outline-hidden"
);

/** Same footprint as the rendered trigger, so the action row does not shift. */
export const ShareMenuSkeleton = () => (
  <div
    aria-hidden="true"
    className="h-10 w-28 animate-pulse rounded-control bg-muted"
  />
);

/**
 * The control a reader passes a page on with.
 *
 * Where the browser has the Web Share API the platform's own sheet is what
 * opens — it lists the apps the reader actually sends things through, which no
 * menu written here can match. The popover is what stands in everywhere else,
 * and it is a plain list of links and one button, so a keyboard reaches every
 * one of them through the popover Base UI already manages.
 *
 * Both are driven from one controlled `open`, rather than from a branch on
 * `navigator.share` during render: the API exists only in the browser, so a
 * rendered branch would disagree with what the server sent and hydration would
 * throw the markup away. The decision is made when the trigger is pressed,
 * which is also where the sheet's transient user activation comes from.
 *
 * `url` is the canonical address of the page rather than the one in the address
 * bar, so a link a reader sends carries no filter, cursor, or checkout
 * parameter they happened to arrive with.
 *
 * `title` and `text` are two different sentences and neither stands in for the
 * other. `title` is what this page is called, and it is what the trigger is
 * read out as — so it stays short however much the message beside it grows.
 * `text` is the message the share carries, composed by the caller: the work and
 * its credits today, and whatever else a screen decides to say tomorrow.
 * Composing it here instead would put a decision about wording, and the list
 * joining a reader's language asks for, inside a control that renders a button.
 */
export const ShareMenu = ({
  text,
  title,
  url,
}: {
  /** The message a share carries, already worded for this reader. */
  text: string;
  /** What this page is called, and nothing else. */
  title: string;
  url: string;
}) => {
  const t = useClientMessages();
  const [open, setOpen] = useState(false);
  const [copyOutcome, setCopyOutcome] = useState<CopyOutcome>(null);

  const openShareSheet = async () => {
    try {
      await navigator.share({ text, title, url });
    } catch (error) {
      // Dismissing the sheet rejects with `AbortError`. That is the reader
      // deciding not to share, not a failure, so nothing stands in for it.
      // Anything else means no sheet ever appeared, and the popover is then the
      // only way on.
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      setOpen(true);
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setOpen(false);
      setCopyOutcome(null);
      return;
    }

    if (typeof navigator.share === "function") {
      // Called rather than awaited: the sheet is asked for synchronously, which
      // is what keeps it inside the click's transient user activation.
      void openShareSheet();
      return;
    }

    setOpen(true);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      setCopyOutcome("failed");
      return;
    }

    setCopyOutcome("copied");
  };

  return (
    <Popover onOpenChange={handleOpenChange} open={open}>
      <PopoverTrigger
        aria-label={t("host.share.aria", { title })}
        className={buttonVariants({ size: "lg", variant: "outline" })}
      >
        <ShareIcon aria-hidden="true" className="size-4" />
        {t("host.share.action")}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56" sideOffset={8}>
        <PopoverTitle className="px-2 py-1.5 text-sm font-medium text-foreground">
          {t("host.share.action")}
        </PopoverTitle>
        <div className="grid gap-0.5">
          <a
            className={SHARE_ROW}
            href={withShareParams(X_INTENT_URL, text, url)}
            rel="noopener noreferrer"
            target="_blank"
          >
            {t("host.share.x")}
          </a>
          <a
            className={SHARE_ROW}
            href={withShareParams(LINE_SHARE_URL, text, url)}
            rel="noopener noreferrer"
            target="_blank"
          >
            {t("host.share.line")}
          </a>
          {/* No icon, though a copy control usually carries one: the two rows
              above it are brand marks this repository does not ship, so an icon
              here would indent one row of three. */}
          <button className={SHARE_ROW} onClick={handleCopy} type="button">
            {t("host.share.copy_link")}
          </button>
        </div>
        {copyOutcome ? (
          <output
            className={cn(
              "block px-3 py-1.5 text-xs",
              copyOutcome === "copied" ? "text-success" : "text-destructive"
            )}
          >
            {copyOutcome === "copied"
              ? t("host.share.copied")
              : t("host.share.copy_failed")}
          </output>
        ) : null}
      </PopoverContent>
    </Popover>
  );
};
