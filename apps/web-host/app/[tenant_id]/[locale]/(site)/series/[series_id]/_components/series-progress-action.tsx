import { getMessage } from "@publira/i18n";
import { LinkButton } from "@publira/ui-components/button";
import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import type { EpisodeItem } from "#lib/catalog";
import { getLocale, loadHostMessages } from "#lib/locale";
import { getMySeriesProgress } from "#lib/reading-progress";

import { resolveContinueOffer } from "../_lib/continue-offer";

/**
 * The reader's own call to action on a series page: "Read episode 1" for a
 * member who has opened none of it, "Continue from episode N" for one who
 * stopped inside an episode.
 *
 * Member-specific, like the follow control it sits under, so it belongs in its
 * own `<Suspense>`: the series detail around it stays on the shared public
 * cache and its static shell is unchanged. A guest gets nothing — the series
 * page a signed-out reader sees is the page they have always seen.
 */
export const SeriesProgressAction = async ({
  episodes,
  seriesPublicId,
  tenantId,
}: {
  episodes: EpisodeItem[];
  seriesPublicId: string;
  tenantId: string;
}) => {
  const locale = await getLocale();
  const [result, messages] = await Promise.all([
    getMySeriesProgress(tenantId, seriesPublicId, locale),
    loadHostMessages(locale),
  ]);

  if (!result.ok) {
    return (
      <SectionError className="mt-6 max-w-sm">
        <SectionErrorHeading>
          <SectionErrorTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="host.series.progress_error" />
            </Suspense>
          </SectionErrorTitle>
          <SectionErrorDescription>{result.message}</SectionErrorDescription>
        </SectionErrorHeading>
      </SectionError>
    );
  }

  if (!result.signedIn) {
    return null;
  }

  const offer = resolveContinueOffer(episodes, result.progress);
  if (!offer) {
    return null;
  }

  return (
    <LinkButton
      className="mt-6"
      render={
        <LocaleLink
          href={`/series/${seriesPublicId}/episodes/${offer.episodePublicId}`}
        />
      }
      size="lg"
    >
      {getMessage(messages, offer.label, { number: offer.orderIndex })}
    </LinkButton>
  );
};
