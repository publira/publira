"use client";

import { getMessage, toIntlLocale } from "@publira/i18n";
import { HeartIcon } from "@publira/icons";
import { Button, LinkButton } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import { Skeleton } from "@publira/ui-components/skeleton";
import { cn } from "@publira/utils";
import Link from "next/link";
import {
  createContext,
  startTransition,
  use,
  useActionState,
  useId,
  useMemo,
  useOptimistic,
  useRef,
} from "react";
import type { ReactNode } from "react";

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
import type { HostMessageKey } from "#lib/messages";

import { useHostMessages } from "./client-message";
import { LocaleField } from "./locale-field";
import { useLocale } from "./locale-provider";

/**
 * Compound face of the episode reaction control: an outline control that
 * holds a heart and the reader headcount.
 *
 * The root owns size. Login and Form each own a face — fill, score, and
 * headcount — so Heart and Count read those values from context rather than
 * taking them as props. Copy is written on the named slot that renders it:
 * the accessible name is sr-only children of Name, never a `copy` bag. A
 * static slot takes `<Message>` as its node. Progress and Readers take a
 * catalog key instead, because their values change in the browser and are
 * resolved from the client catalog.
 *
 * ```tsx
 * <EpisodeReaction size="sm">
 *   <EpisodeReactionLogin href={loginHref} ratingCount={12}>
 *     <EpisodeReactionName>
 *       <EpisodeReactionNameIdle>
 *         <Message message="host.episode.reaction.login_aria" />
 *       </EpisodeReactionNameIdle>
 *       <EpisodeReactionNameReaders message="host.episode.reaction.count_aria" />
 *     </EpisodeReactionName>
 *     <EpisodeReactionHeart />
 *     <EpisodeReactionCount />
 *   </EpisodeReactionLogin>
 * </EpisodeReaction>
 * ```
 */
export type EpisodeReactionSize = "lg" | "sm";

interface EpisodeReactionFace {
  error: string | null;
  fillRatio: number;
  mode: EpisodeReactionMode;
  ratingCount: number;
  score: number;
}

const EpisodeReactionSizeContext = createContext<EpisodeReactionSize>("lg");
const EpisodeReactionFaceContext = createContext<EpisodeReactionFace | null>(
  null
);
const EpisodeReactionNameIdContext = createContext<string | null>(null);

const reactionButtonClassName = "shrink-0 tabular-nums";

const heartClassNameForSize = (size: EpisodeReactionSize): string =>
  size === "sm" ? "size-4" : "size-5";

const skeletonClassNameForSize = (size: EpisodeReactionSize): string =>
  size === "sm" ? "h-8 w-16" : "h-10 w-20";

const useEpisodeReactionFace = (): EpisodeReactionFace => {
  const face = use(EpisodeReactionFaceContext);
  if (!face) {
    throw new Error(
      "EpisodeReaction slots must be rendered inside EpisodeReactionLogin or EpisodeReactionForm."
    );
  }
  return face;
};

const useEpisodeReactionNameId = (): string => {
  const id = use(EpisodeReactionNameIdContext);
  if (!id) {
    throw new Error(
      "EpisodeReactionName must be rendered inside EpisodeReactionLogin or EpisodeReactionSubmit."
    );
  }
  return id;
};

export const EpisodeReaction = ({
  children,
  size = "lg",
}: {
  children: ReactNode;
  size?: EpisodeReactionSize;
}) => (
  <EpisodeReactionSizeContext value={size}>
    {children}
  </EpisodeReactionSizeContext>
);

/**
 * How far the reader has taken the reaction, drawn as a fill over the heart.
 * Empty until the first press; in `single` mode one press fills it, in
 * `multiple` mode the fill is `score / 5`. Omitting `fillRatio` reads the
 * face Login or Form is showing.
 */
export const EpisodeReactionHeart = ({ fillRatio }: { fillRatio?: number }) => {
  const size = use(EpisodeReactionSizeContext);
  const face = use(EpisodeReactionFaceContext);
  const ratio = fillRatio ?? face?.fillRatio ?? 0;
  const heartClassName = heartClassNameForSize(size);

  return (
    <span
      aria-hidden="true"
      className={cn("relative inline-block", heartClassName)}
    >
      <HeartIcon className={heartClassName} />
      {ratio > 0 ? (
        <span
          className={cn(
            "absolute inset-0 overflow-hidden text-secondary",
            heartClassName
          )}
          style={{
            clipPath: `inset(${(1 - ratio) * 100}% 0 0 0)`,
          }}
        >
          <HeartIcon className={cn(heartClassName, "fill-current")} />
        </span>
      ) : null}
    </span>
  );
};

/** The public headcount, formatted in the reader's locale. */
export const EpisodeReactionCount = () => {
  const locale = useLocale();
  const { ratingCount } = useEpisodeReactionFace();

  return (
    <span aria-hidden="true">
      {ratingCount.toLocaleString(toIntlLocale(locale))}
    </span>
  );
};

export const EpisodeReactionLogin = ({
  children,
  href,
  ratingCount,
}: {
  children: ReactNode;
  href: string;
  ratingCount: number;
}) => {
  const size = use(EpisodeReactionSizeContext);
  const nameId = useId();
  const face = useMemo(
    (): EpisodeReactionFace => ({
      error: null,
      fillRatio: 0,
      mode: "single",
      ratingCount,
      score: 0,
    }),
    [ratingCount]
  );

  return (
    <EpisodeReactionNameIdContext value={nameId}>
      <EpisodeReactionFaceContext value={face}>
        <LinkButton
          aria-labelledby={nameId}
          className={reactionButtonClassName}
          render={<Link href={href} />}
          size={size}
          variant="outline"
        >
          {children}
        </LinkButton>
      </EpisodeReactionFaceContext>
    </EpisodeReactionNameIdContext>
  );
};

/**
 * The signed-in control. Presses are optimistic and batched into one request
 * so a burst in `multiple` mode is one `presses` value rather than a race.
 */
export const EpisodeReactionForm = ({
  children,
  episodePublicId,
  mode,
  ratingCount,
  returnTo,
  score,
  seriesPublicId,
  tenantId,
}: {
  children: ReactNode;
  episodePublicId: string;
  mode: EpisodeReactionMode;
  ratingCount: number;
  returnTo: string;
  score: number;
  seriesPublicId: string;
  tenantId: string;
}) => {
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
  const face = useMemo(
    (): EpisodeReactionFace => ({
      error: state && !state.ok ? state.message : null,
      fillRatio: reactionFillRatio(optimistic.score, mode),
      mode,
      ratingCount: optimistic.ratingCount,
      score: optimistic.score,
    }),
    [mode, optimistic, state]
  );

  return (
    <EpisodeReactionFaceContext value={face}>
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
        {children}
      </form>
    </EpisodeReactionFaceContext>
  );
};

export const EpisodeReactionSubmit = ({
  children,
}: {
  children: ReactNode;
}) => {
  const size = use(EpisodeReactionSizeContext);
  const nameId = useId();

  return (
    <EpisodeReactionNameIdContext value={nameId}>
      <Button
        aria-labelledby={nameId}
        className={reactionButtonClassName}
        size={size}
        type="submit"
        variant="outline"
      >
        {children}
      </Button>
    </EpisodeReactionNameIdContext>
  );
};

/**
 * Accessible name of the control, hidden visually. Action slots self-hide
 * from the score on the face; Readers is the trailing clause, so it leads
 * with a period to keep `{action}. {readers}` as the computed name.
 */
export const EpisodeReactionName = ({ children }: { children: ReactNode }) => {
  const id = useEpisodeReactionNameId();

  return (
    <span className="sr-only" id={id}>
      {children}
    </span>
  );
};

export const EpisodeReactionNameIdle = ({
  children,
}: {
  children: ReactNode;
}) => {
  const { score } = useEpisodeReactionFace();
  if (score > 0) {
    return null;
  }
  return children;
};

export const EpisodeReactionNameProgress = ({
  message,
}: {
  message: HostMessageKey;
}) => {
  const messages = useHostMessages();
  const { mode, score } = useEpisodeReactionFace();
  if (
    mode !== "multiple" ||
    score <= 0 ||
    score >= MAX_EPISODE_REACTION_SCORE
  ) {
    return null;
  }

  return getMessage(messages, message, {
    max: MAX_EPISODE_REACTION_SCORE,
    score,
  });
};

export const EpisodeReactionNameDone = ({
  children,
}: {
  children: ReactNode;
}) => {
  const { score } = useEpisodeReactionFace();
  if (score < MAX_EPISODE_REACTION_SCORE) {
    return null;
  }
  return children;
};

export const EpisodeReactionNameReaders = ({
  message,
}: {
  message: HostMessageKey;
}) => {
  const locale = useLocale();
  const messages = useHostMessages();
  const { ratingCount } = useEpisodeReactionFace();
  const count = ratingCount.toLocaleString(toIntlLocale(locale));

  return `. ${getMessage(messages, message, { count })}`;
};

export const EpisodeReactionError = () => {
  const { error } = useEpisodeReactionFace();
  if (!error) {
    return null;
  }
  return <FormMessage variant="destructive">{error}</FormMessage>;
};

export const EpisodeReactionSkeleton = ({
  size = "lg",
}: {
  size?: EpisodeReactionSize;
}) => <Skeleton className={skeletonClassNameForSize(size)} />;
