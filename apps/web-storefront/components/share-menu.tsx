"use client";

import { ShareIcon } from "@publira/icons/share-icon";
import { buttonVariants } from "@publira/ui-components/button";
import * as Popover from "@publira/ui-components/popover";
import { Skeleton } from "@publira/ui-components/skeleton";
import { cn } from "@publira/utils";
import { useState } from "react";
import type { ReactNode } from "react";

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

/** Whether the browser has a share sheet to open; not every one does. */
const offersShareSheet = (
  share: Navigator["share"] | undefined
): share is Navigator["share"] => typeof share === "function";

/** How the copy control reports what happened, or nothing until it is used. */
type CopyOutcome = "copied" | "failed" | null;

const SHARE_ROW = cn(
  "flex items-center gap-2 rounded-control px-3 py-2 text-left text-sm text-muted-foreground transition-colors duration-state ease-state hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:outline-hidden"
);

/**
 * Where a row's mark sits, and the same width left empty on a row without one.
 * The mark the caller hands over fills it at its own aspect ratio.
 */
const MarkSlot = ({ children }: { children?: ReactNode }) => (
  <span aria-hidden="true" className="flex size-4 shrink-0 items-center">
    {children}
  </span>
);

/** Same footprint as the rendered trigger, so the action row does not shift. */
export const ShareMenuSkeleton = () => <Skeleton className="h-10 w-28" />;

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
 *
 * `xMark` and `lineMark` are the services' own marks, which only a tenant that
 * uploaded them has: the repository ships neither. A row without one is its
 * label alone.
 */
export const ShareMenu = ({
  lineMark,
  text,
  title,
  url,
  xMark,
}: {
  /** LINE's mark, drawn at the head of the LINE row; absent where none is. */
  lineMark?: ReactNode;
  /** The message a share carries, already worded for this reader. */
  text: string;
  /** What this page is called, and nothing else. */
  title: string;
  url: string;
  /** X's mark, drawn at the head of the X row; absent where none is. */
  xMark?: ReactNode;
}) => {
  const t = useClientMessages();
  const [open, setOpen] = useState(false);
  const [copyOutcome, setCopyOutcome] = useState<CopyOutcome>(null);
  const marked = Boolean(xMark || lineMark);

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

    if (offersShareSheet(navigator.share)) {
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
    <Popover.Root onOpenChange={handleOpenChange} open={open}>
      <Popover.Trigger
        aria-label={t("storefront.share.aria", { title })}
        className={buttonVariants({ size: "lg", variant: "outline" })}
      >
        <ShareIcon aria-hidden="true" className="size-4" />
        {t("storefront.share.action")}
      </Popover.Trigger>
      <Popover.Content align="start" className="w-56" sideOffset={8}>
        <Popover.Title className="px-2 py-1.5 text-sm font-medium text-foreground">
          {t("storefront.share.action")}
        </Popover.Title>
        <div className="grid gap-0.5">
          <a
            className={SHARE_ROW}
            href={withShareParams(X_INTENT_URL, text, url)}
            rel="noopener noreferrer"
            target="_blank"
          >
            {marked ? <MarkSlot>{xMark}</MarkSlot> : null}
            {t("storefront.share.x")}
          </a>
          <a
            className={SHARE_ROW}
            href={withShareParams(LINE_SHARE_URL, text, url)}
            rel="noopener noreferrer"
            target="_blank"
          >
            {marked ? <MarkSlot>{lineMark}</MarkSlot> : null}
            {t("storefront.share.line")}
          </a>
          {/* An empty slot of the marks' width rather than a copy icon: once
              either row above carries a mark, every row keeps a slot so the
              three labels start on one line. With no mark, no row reserves
              one, and the labels already do. */}
          <button className={SHARE_ROW} onClick={handleCopy} type="button">
            {marked ? <MarkSlot /> : null}
            {t("storefront.share.copy_link")}
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
              ? t("storefront.share.copied")
              : t("storefront.share.copy_failed")}
          </output>
        ) : null}
      </Popover.Content>
    </Popover.Root>
  );
};
