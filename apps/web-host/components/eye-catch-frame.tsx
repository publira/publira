import { cn } from "@publira/utils";
import type { ReactNode } from "react";

import type { EyeCatchVariant } from "#components/eye-catch-picture";
import { EyeCatchPicture } from "#components/eye-catch-picture";

/**
 * The frame a piece of artwork sits in, and what stands there when the work
 * has none: a flat `muted` rectangle carrying whatever the caller writes into
 * it, which for anything larger than a thumbnail is the title in the serif
 * face. No gradient and no icon — a title says which work this is, and the two
 * alternatives say nothing. A thumbnail is too small to carry a title, so at
 * that size the caller writes nothing and the rectangle stays flat, which also
 * keeps the rows of a list aligned on one left edge.
 *
 * A `<span>` rather than a `<div>`, because most of these frames are the first
 * child of a link that wraps a whole row.
 */
export const EyeCatchFrame = ({
  alt,
  children,
  className,
  fetchPriority,
  loading,
  preferredType,
  sizes,
  variants,
}: {
  alt: string;
  children?: ReactNode;
  className: string;
  fetchPriority?: "high" | "low" | "auto";
  loading?: "eager" | "lazy";
  preferredType?: string;
  sizes?: string;
  variants: EyeCatchVariant[] | undefined;
}) =>
  variants && variants.length > 0 ? (
    <span className={cn("block overflow-hidden bg-muted", className)}>
      <EyeCatchPicture
        alt={alt}
        fetchPriority={fetchPriority}
        imgClassName="size-full object-cover"
        loading={loading}
        preferredType={preferredType}
        sizes={sizes}
        variants={variants}
      />
    </span>
  ) : (
    // The rectangle stands in for the artwork, so it is hidden from assistive
    // technology exactly as an `alt=""` image would be: the title written into
    // it is a drawing of the title, and the real one is beside it in the link.
    <span
      aria-hidden="true"
      className={cn(
        "flex items-center justify-center overflow-hidden bg-muted p-3 text-center",
        className
      )}
    >
      {children}
    </span>
  );
