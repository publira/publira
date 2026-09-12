"use client";

import { formatMessage, toIntlLocale } from "@publira/i18n";
import { HeartIcon } from "@publira/icons";
import { Button, LinkButton } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import { Skeleton } from "@publira/ui-components/skeleton";
import { cn } from "@publira/utils";
import Link from "next/link";
import { startTransition, useActionState, useOptimistic, useRef } from "react";

import type {
  EpisodeReactionMode,
  EpisodeReactionState,
} from "#lib/episode-rating";
import {
  applyReactionPress,
  MAX_EPISODE_REACTION_SCORE,
  reactionFillRatio,
} from "#lib/episode-rating";
import type { RateEpisodeActionState } from "#lib/episode-rating-actions";
import { rateEpisodeAction } from "#lib/episode-rating-actions";

import { LocaleField } from "./locale-field";
import { useLocale } from "./locale-provider";

/**
 * The control's copy, resolved on the server. Count and progress labels are
 * MessageFormat patterns so the client can keep them in step with optimistic
 * presses; the rest land in `aria-label` as already-resolved strings.
 */
export interface EpisodeReactionButtonCopy {
  countAria: string;
  loginAria: string;
  maxAria: string;
  pressAria: string;
  pressProgressAria: string;
}

export type EpisodeReactionControlSize = "lg" | "sm";

const reactionButtonClassName = "shrink-0 tabular-nums";

const heartClassNameForSize = (size: EpisodeReactionControlSize): string =>
  size === "sm" ? "size-4" : "size-5";

const skeletonClassNameForSize = (size: EpisodeReactionControlSize): string =>
  size === "sm" ? "h-8 w-16" : "h-10 w-20";

const ReactionHeart = ({
  fillRatio,
  size,
}: {
  fillRatio: number;
  size: EpisodeReactionControlSize;
}) => {
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

const reactionAriaLabel = (
  copy: EpisodeReactionButtonCopy,
  countLabel: string,
  mode: EpisodeReactionMode,
  score: number
): string => {
  let action = copy.pressAria;
  if (score >= MAX_EPISODE_REACTION_SCORE) {
    action = copy.maxAria;
  } else if (mode === "multiple" && score > 0) {
    action = formatMessage(copy.pressProgressAria, {
      max: MAX_EPISODE_REACTION_SCORE,
      score,
    });
  }
  return `${action}. ${countLabel}`;
};

export const EpisodeReactionControlSkeleton = ({
  size = "lg",
}: {
  size?: EpisodeReactionControlSize;
}) => <Skeleton className={skeletonClassNameForSize(size)} />;

export const EpisodeReactionLoginLink = ({
  copy,
  href,
  ratingCount,
  size = "lg",
}: {
  copy: EpisodeReactionButtonCopy;
  href: string;
  ratingCount: number;
  size?: EpisodeReactionControlSize;
}) => {
  const locale = useLocale();
  const count = ratingCount.toLocaleString(toIntlLocale(locale));
  const countLabel = formatMessage(copy.countAria, { count });

  return (
    <LinkButton
      aria-label={`${copy.loginAria}. ${countLabel}`}
      className={reactionButtonClassName}
      render={<Link href={href} />}
      size={size}
      variant="outline"
    >
      <ReactionHeart fillRatio={0} size={size} />
      {count}
    </LinkButton>
  );
};

export const EpisodeReactionButton = ({
  copy,
  episodePublicId,
  mode,
  ratingCount,
  returnTo,
  score,
  seriesPublicId,
  size = "lg",
  tenantId,
}: {
  copy: EpisodeReactionButtonCopy;
  episodePublicId: string;
  mode: EpisodeReactionMode;
  ratingCount: number;
  returnTo: string;
  score: number;
  seriesPublicId: string;
  size?: EpisodeReactionControlSize;
  tenantId: string;
}) => {
  const locale = useLocale();
  const [state, formAction] = useActionState(
    rateEpisodeAction,
    null as RateEpisodeActionState
  );
  const confirmed = state?.ok
    ? { ratingCount: state.ratingCount, score: state.score }
    : { ratingCount, score };
  const [optimistic, addOptimistic] = useOptimistic(confirmed, (current) =>
    applyReactionPress(current, mode)
  );
  const displayRef = useRef<EpisodeReactionState | null>(null);
  const queuedPressesRef = useRef(0);
  const flushPromiseRef = useRef<Promise<void> | null>(null);
  const fillRatio = reactionFillRatio(optimistic.score, mode);
  const count = optimistic.ratingCount.toLocaleString(toIntlLocale(locale));
  const countLabel = formatMessage(copy.countAria, { count });

  return (
    <form
      action={async (formData) => {
        const current = displayRef.current ?? {
          ratingCount: optimistic.ratingCount,
          score: optimistic.score,
        };
        if (current.score >= MAX_EPISODE_REACTION_SCORE) {
          if (flushPromiseRef.current) {
            await flushPromiseRef.current;
          }
          return;
        }
        const next = applyReactionPress(current, mode);
        displayRef.current = next;
        addOptimistic(1);
        queuedPressesRef.current += 1;

        if (flushPromiseRef.current) {
          await flushPromiseRef.current;
          return;
        }

        const flush = (async () => {
          await Promise.resolve();
          const presses = queuedPressesRef.current;
          queuedPressesRef.current = 0;
          displayRef.current = null;
          flushPromiseRef.current = null;
          formData.set("presses", String(Math.max(1, presses)));
          startTransition(() => {
            formAction(formData);
          });
        })();
        flushPromiseRef.current = flush;
        await flush;
      }}
      className="grid justify-items-start gap-2"
    >
      <LocaleField />
      <input name="episodePublicId" type="hidden" value={episodePublicId} />
      <input name="presses" type="hidden" value="1" />
      <input name="returnTo" type="hidden" value={returnTo} />
      <input name="seriesPublicId" type="hidden" value={seriesPublicId} />
      <input name="tenantId" type="hidden" value={tenantId} />
      <Button
        aria-label={reactionAriaLabel(copy, countLabel, mode, optimistic.score)}
        className={reactionButtonClassName}
        size={size}
        type="submit"
        variant="outline"
      >
        <ReactionHeart fillRatio={fillRatio} size={size} />
        {count}
      </Button>
      {state && !state.ok ? (
        <FormMessage variant="destructive">{state.message}</FormMessage>
      ) : null}
    </form>
  );
};
