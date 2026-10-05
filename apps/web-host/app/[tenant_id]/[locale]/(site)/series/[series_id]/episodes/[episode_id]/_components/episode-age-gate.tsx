import type { Locale } from "@publira/i18n";
import { LinkButton } from "@publira/ui-components/button";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { FreeUntilBadge } from "#components/free-until-badge";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";

import { episodeLoginHref } from "../_lib/access-gate";

/**
 * The card over the preview when the tenant makes a reader prove an age for
 * this series and they have not. Its three states are the three things that
 * can be missing: the session, the birth date, or the years themselves.
 *
 * Unlike the access gate it offers no free episode to read instead: the rule
 * covers the whole series, so every episode of it is closed the same way.
 *
 * It is the one gate an episode in an open free reading period can show: the
 * period makes the body free, so the access gate never closes over it. The
 * card says until when wherever proving the age is a step the reader can
 * still take, because that is the deadline the step races. A reader who is
 * too young is told nothing of it, as the period opens nothing for them.
 */
export const EpisodeAgeGate = ({
  episodePublicId,
  freeUntil,
  hasBirthDate,
  locale,
  seriesPublicId,
  signedIn,
  timeZone,
}: {
  episodePublicId: string;
  /** RFC3339 end of the free reading period open on the episode, if any. */
  freeUntil?: string;
  /** Whether the reader has already given a date, which they cannot rewrite. */
  hasBirthDate: boolean;
  locale: Locale;
  seriesPublicId: string;
  signedIn: boolean;
  timeZone: string;
}) => {
  // Each branch writes its own key out, the way the access gate beside it does:
  // a key chosen elsewhere and handed over as a value is one that nothing
  // reading this file can account for.
  let closedBecause: ReactNode;
  let ageAction: ReactNode = null;
  if (!signedIn) {
    closedBecause = (
      <Message message="host.episode.age_gate.guest_description" />
    );
    ageAction = (
      <LinkButton
        render={
          <LocaleLink
            href={episodeLoginHref(seriesPublicId, episodePublicId)}
          />
        }
        size="lg"
        variant="secondary"
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
          <Message message="host.episode.gate.login" />
        </Suspense>
      </LinkButton>
    );
  } else if (hasBirthDate) {
    closedBecause = (
      <Message message="host.episode.age_gate.too_young_description" />
    );
  } else {
    closedBecause = (
      <Message message="host.episode.age_gate.no_birth_date_description" />
    );
    ageAction = (
      <LinkButton
        render={<LocaleLink href="/settings" />}
        size="lg"
        variant="secondary"
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
          <Message message="host.episode.age_gate.add_birth_date" />
        </Suspense>
      </LinkButton>
    );
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        {freeUntil && ageAction ? (
          <p>
            <FreeUntilBadge
              freeUntil={freeUntil}
              locale={locale}
              timeZone={timeZone}
            />
          </p>
        ) : null}
        <p className="font-serif text-xl leading-tight">
          <Suspense fallback={<SkeletonLine className="mx-auto h-5 w-64" />}>
            <Message message="host.episode.age_gate.title" />
          </Suspense>
        </p>
        <p className="text-sm text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            {closedBecause}
          </Suspense>
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        {ageAction}
        <LinkButton
          render={<LocaleLink href={`/series/${seriesPublicId}`} />}
          variant="outline"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
            <Message message="host.episode.to_series_detail" />
          </Suspense>
        </LinkButton>
      </div>
    </div>
  );
};
