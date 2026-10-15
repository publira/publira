"use client";

import { UserIcon } from "@publira/icons";
import { cn } from "@publira/utils";
import Image from "next/image";
import { useState } from "react";

import type { ReaderIconImage } from "#lib/reader-icon";

/**
 * The squares the console draws an icon at, in CSS pixels: beside a name in a
 * list row, and on the reader's own page.
 */
const SIZE_CLASS_NAMES = {
  32: "size-8",
  64: "size-16",
} as const;

export type ReaderIconSize = keyof typeof SIZE_CLASS_NAMES;

/**
 * The icon an account shows, or the person outline the storefront draws for
 * an account that shows none.
 *
 * The outline also stands in when the image does not load. A removed icon's
 * URL stops answering at once, so a page drawn before staff removed it — the
 * list in another tab, the reader page the removal redirects back to while a
 * cached payload is still on screen — would otherwise show a broken image.
 */
export const ReaderIcon = ({
  alt,
  icon,
  size,
}: {
  /**
   * Names the image, and is empty where the reader's name is beside it, which
   * already says whose it is. The outline is never announced: it stands for
   * the absence of an icon, which a screen that needs to say so says in words.
   */
  alt: string;
  icon: ReaderIconImage | null;
  size: ReaderIconSize;
}) => {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (!icon || failedUrl === icon.url) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full border border-border bg-muted",
          SIZE_CLASS_NAMES[size]
        )}
      >
        <UserIcon className="size-1/2 text-muted-foreground" />
      </span>
    );
  }

  return (
    <Image
      alt={alt}
      className={cn(
        "shrink-0 rounded-full border border-border object-cover",
        SIZE_CLASS_NAMES[size]
      )}
      height={size}
      onError={() => setFailedUrl(icon.url)}
      src={icon.url}
      width={size}
    />
  );
};
