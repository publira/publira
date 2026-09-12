"use client";

import { formatMessage, toIntlLocale } from "@publira/i18n";
import { FormMessage } from "@publira/ui-components/form-message";
import { startTransition, useActionState, useOptimistic, useRef } from "react";

import type { RateEpisodeActionState } from "#lib/episode-rating-actions";
import { rateEpisodeAction } from "#lib/episode-rating-actions";
import type {
  EpisodeReactionMode,
  EpisodeReactionState,
} from "#lib/episode-rating-state";
import {
  applyReactionPress,
  MAX_EPISODE_REACTION_SCORE,
  reactionFillRatio,
} from "#lib/episode-rating-state";

import type { EpisodeReactionSize } from "./episode-reaction";
import {
  EpisodeReactionHeart,
  EpisodeReactionSubmit,
} from "./episode-reaction";
import { LocaleField } from "./locale-field";
import { useLocale } from "./locale-provider";

/**
 * MessageFormat patterns the optimistic face interpolates as the score and
 * the headcount move. They cannot be nodes: they land in `aria-label`.
 */
export interface EpisodeReactionButtonCopy {
  countAria: string;
  maxAria: string;
  pressAria: string;
  pressProgressAria: string;
}

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

/**
 * The signed-in control. Presses are optimistic and batched into one request
 * so a burst in `multiple` mode is one `presses` value rather than a race.
 */
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
  size?: EpisodeReactionSize;
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
      <EpisodeReactionSubmit
        aria-label={reactionAriaLabel(copy, countLabel, mode, optimistic.score)}
        size={size}
      >
        <EpisodeReactionHeart fillRatio={fillRatio} />
        {count}
      </EpisodeReactionSubmit>
      {state && !state.ok ? (
        <FormMessage variant="destructive">{state.message}</FormMessage>
      ) : null}
    </form>
  );
};
