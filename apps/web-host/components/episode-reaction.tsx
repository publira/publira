"use client";

import { HeartIcon } from "@publira/icons";
import { Button, LinkButton } from "@publira/ui-components/button";
import { Skeleton } from "@publira/ui-components/skeleton";
import { cn } from "@publira/utils";
import Link from "next/link";
import { createContext, use } from "react";
import type { ReactNode } from "react";

/**
 * Compound face of the episode reaction control: an outline control that
 * holds a heart and the reader headcount.
 *
 * Composed rather than prop-driven so the count is a child node and the
 * accessible name sits on the slot that actually carries it. The login link
 * and the submit button share that face; only the root differs.
 *
 * ```tsx
 * <EpisodeReactionLogin aria-label={…} href={loginHref} size="sm">
 *   <EpisodeReactionHeart />
 *   {count}
 * </EpisodeReactionLogin>
 *
 * <EpisodeReactionSubmit aria-label={…} size="sm">
 *   <EpisodeReactionHeart fillRatio={score / 5} />
 *   {count}
 * </EpisodeReactionSubmit>
 * ```
 */
export type EpisodeReactionSize = "lg" | "sm";

const EpisodeReactionSizeContext = createContext<EpisodeReactionSize>("lg");

const reactionButtonClassName = "shrink-0 tabular-nums";

const heartClassNameForSize = (size: EpisodeReactionSize): string =>
  size === "sm" ? "size-4" : "size-5";

const skeletonClassNameForSize = (size: EpisodeReactionSize): string =>
  size === "sm" ? "h-8 w-16" : "h-10 w-20";

/**
 * How far the reader has taken the reaction, drawn as a fill over the heart.
 * Empty until the first press; in `single` mode one press fills it, in
 * `multiple` mode the fill is `score / 5`.
 */
export const EpisodeReactionHeart = ({
  fillRatio = 0,
}: {
  fillRatio?: number;
}) => {
  const size = use(EpisodeReactionSizeContext);
  const heartClassName = heartClassNameForSize(size);

  return (
    <span
      aria-hidden="true"
      className={cn("relative inline-block", heartClassName)}
    >
      <HeartIcon className={heartClassName} />
      {fillRatio > 0 ? (
        <span
          className={cn(
            "absolute inset-0 overflow-hidden text-secondary",
            heartClassName
          )}
          style={{
            clipPath: `inset(${(1 - fillRatio) * 100}% 0 0 0)`,
          }}
        >
          <HeartIcon className={cn(heartClassName, "fill-current")} />
        </span>
      ) : null}
    </span>
  );
};

export const EpisodeReactionLogin = ({
  "aria-label": ariaLabel,
  children,
  href,
  size = "lg",
}: {
  "aria-label": string;
  children: ReactNode;
  href: string;
  size?: EpisodeReactionSize;
}) => (
  <EpisodeReactionSizeContext value={size}>
    <LinkButton
      aria-label={ariaLabel}
      className={reactionButtonClassName}
      render={<Link href={href} />}
      size={size}
      variant="outline"
    >
      {children}
    </LinkButton>
  </EpisodeReactionSizeContext>
);

export const EpisodeReactionSubmit = ({
  "aria-label": ariaLabel,
  children,
  size = "lg",
}: {
  "aria-label": string;
  children: ReactNode;
  size?: EpisodeReactionSize;
}) => (
  <EpisodeReactionSizeContext value={size}>
    <Button
      aria-label={ariaLabel}
      className={reactionButtonClassName}
      size={size}
      type="submit"
      variant="outline"
    >
      {children}
    </Button>
  </EpisodeReactionSizeContext>
);

export const EpisodeReactionSkeleton = ({
  size = "lg",
}: {
  size?: EpisodeReactionSize;
}) => <Skeleton className={skeletonClassNameForSize(size)} />;
