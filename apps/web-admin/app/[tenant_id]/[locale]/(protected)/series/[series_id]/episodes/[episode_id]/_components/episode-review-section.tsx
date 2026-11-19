import type { Locale } from "@publira/i18n";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import { Badge } from "@publira/ui-components/badge";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { formatDateTime } from "@publira/utils";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { Message } from "#components/message";
import type { EpisodeReviewRoundItem } from "#lib/episode-review";
import type { EpisodeReviewStateValue } from "#lib/episode-review-state";

interface EpisodeReviewSectionProps {
  /** The controls that decide the open round, for a Tenant admin alone. */
  children?: ReactNode;
  locale: Locale;
  /** Oldest first. */
  rounds: EpisodeReviewRoundItem[];
  /** Where the episode stands now, empty while it was never submitted. */
  state: "" | EpisodeReviewStateValue;
  timeZone: string;
}

/** The state a badge names. Each branch keeps its key a literal. */
const ReviewStateBadge = ({ state }: { state: EpisodeReviewStateValue }) => {
  if (state === "approved") {
    return (
      <Badge tone="success" variant="outline">
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <Message message="admin.series.episodes.review.state_approved" />
        </Suspense>
      </Badge>
    );
  }

  if (state === "returned") {
    return (
      <Badge tone="warning" variant="outline">
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <Message message="admin.series.episodes.review.state_returned" />
        </Suspense>
      </Badge>
    );
  }

  return (
    <Badge tone="info" variant="outline">
      <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
        <Message message="admin.series.episodes.review.state_in_review" />
      </Suspense>
    </Badge>
  );
};

/**
 * Who submitted a round and when, without a name for an account deleted
 * since.
 */
const RoundSubmitted = ({ date, name }: { date: string; name: string }) =>
  name ? (
    <Message
      message="admin.series.episodes.review.round_submitted"
      values={{ date, name }}
    />
  ) : (
    <Message
      message="admin.series.episodes.review.round_submitted_unnamed"
      values={{ date }}
    />
  );

/** What came of a round, and who decided it. */
const RoundDecision = ({
  date,
  name,
  state,
}: {
  date: string;
  name: string;
  state: EpisodeReviewStateValue;
}) => {
  if (state === "in_review") {
    return <Message message="admin.series.episodes.review.round_waiting" />;
  }

  if (state === "approved") {
    return name ? (
      <Message
        message="admin.series.episodes.review.round_approved"
        values={{ date, name }}
      />
    ) : (
      <Message
        message="admin.series.episodes.review.round_approved_unnamed"
        values={{ date }}
      />
    );
  }

  return name ? (
    <Message
      message="admin.series.episodes.review.round_returned"
      values={{ date, name }}
    />
  ) : (
    <Message
      message="admin.series.episodes.review.round_returned_unnamed"
      values={{ date }}
    />
  );
};

/**
 * Where the episode stands in review, and every round of it in the order it
 * happened, each with what the Tenant admin wrote: the comment of a return is
 * what its submitter has to fix.
 */
export const EpisodeReviewSection = ({
  children,
  locale,
  rounds,
  state,
  timeZone,
}: EpisodeReviewSectionProps) => (
  <ConsoleSection.Root>
    <ConsoleSection.Header>
      <ConsoleSection.Heading>
        <ConsoleSection.Title>
          <Suspense fallback={<SkeletonLine className="h-5 w-24" />}>
            <Message message="admin.series.episodes.review.title" />
          </Suspense>
        </ConsoleSection.Title>
        <ConsoleSection.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="admin.series.episodes.review.description" />
          </Suspense>
        </ConsoleSection.Description>
      </ConsoleSection.Heading>
      {state ? (
        <ConsoleSection.Actions>
          <ReviewStateBadge state={state} />
        </ConsoleSection.Actions>
      ) : null}
    </ConsoleSection.Header>

    {rounds.length === 0 ? (
      <p className="text-sm text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
          <Message message="admin.series.episodes.review.empty" />
        </Suspense>
      </p>
    ) : (
      <ol className="grid divide-y divide-border border-y border-border">
        {rounds.map((round) => (
          <li className="grid gap-2 py-3" key={round.id}>
            <div className="flex flex-wrap items-center gap-2">
              <ReviewStateBadge state={round.state} />
              <p className="text-sm">
                <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
                  <RoundSubmitted
                    date={formatDateTime(round.submittedAt, {
                      locale,
                      timeZone,
                    })}
                    name={round.submittedByName}
                  />
                </Suspense>
              </p>
            </div>
            <p className="text-sm text-muted-foreground">
              <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
                <RoundDecision
                  date={formatDateTime(round.decidedAt, { locale, timeZone })}
                  name={round.decidedByName}
                  state={round.state}
                />
              </Suspense>
            </p>
            {round.comment ? (
              <blockquote className="border-l-2 border-border pl-3 text-sm whitespace-pre-wrap">
                {round.comment}
              </blockquote>
            ) : null}
          </li>
        ))}
      </ol>
    )}

    {children}
  </ConsoleSection.Root>
);
