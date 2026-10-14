"use client";

import Image from "next/image";
import { useState } from "react";
import type { ReactNode } from "react";

import type { AccountIcon as AccountIconValue } from "#lib/auth";

/**
 * The reader's icon, or `fallback` for an account that shows none.
 *
 * `fallback` also stands in when the image does not load. A replaced or
 * removed icon's URL stops answering, so a page rendered before the change —
 * another tab, a cached payload — would otherwise draw a broken image where
 * the reader's icon was.
 */
export const AccountIcon = ({
  alt,
  className,
  fallback,
  icon,
  size,
}: {
  alt: string;
  className?: string;
  fallback: ReactNode;
  icon: AccountIconValue | null;
  /** The square it is drawn as, in CSS pixels. */
  size: number;
}) => {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (!icon || failedUrl === icon.url) {
    return fallback;
  }

  return (
    <Image
      alt={alt}
      className={className}
      height={size}
      onError={() => setFailedUrl(icon.url)}
      src={icon.url}
      width={size}
    />
  );
};
