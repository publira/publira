import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import { buildLoginPath } from "#lib/auth-shared";
import { getMyEpisodeRating } from "#lib/episode-rating";
import { getLocale } from "#lib/locale";
import { getTenantDefaultLocale } from "#lib/tenant";

import type { EpisodeReactionSize } from "./episode-reaction";
import {
  EpisodeReaction,
  EpisodeReactionCount,
  EpisodeReactionError,
  EpisodeReactionForm,
  EpisodeReactionHeart,
  EpisodeReactionLogin,
  EpisodeReactionName,
  EpisodeReactionNameDone,
  EpisodeReactionNameIdle,
  EpisodeReactionNameProgress,
  EpisodeReactionNameReaders,
  EpisodeReactionSubmit,
} from "./episode-reaction";

/**
 * Member-specific reaction island. The surrounding episode body stays on the
 * public cache; this component must sit inside its own `<Suspense>` so the
 * session cookie does not personalize the static shell.
 *
 * It fills the compound face — heart, headcount, and accessible name as
 * slots — after the private read. The headcount a guest sees is the one the
 * cached episode read already carried. A signed-in reader's own score is a
 * private read next to the follow state, and that same read is what the
 * control takes the live headcount from once they are signed in.
 */
export const EpisodeReactionControl = async ({
  episodePublicId,
  ratingCount,
  returnTo,
  seriesPublicId,
  size = "lg",
  tenantId,
}: {
  episodePublicId: string;
  ratingCount: number;
  returnTo: string;
  seriesPublicId: string;
  size?: EpisodeReactionSize;
  tenantId: string;
}) => {
  const locale = await getLocale();
  const [defaultLocale, result] = await Promise.all([
    getTenantDefaultLocale(tenantId),
    getMyEpisodeRating(tenantId, episodePublicId, locale),
  ]);

  if (!result.ok) {
    return (
      <SectionError className="max-w-sm">
        <SectionErrorHeading>
          <SectionErrorTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="host.episode.reaction.status_error" />
            </Suspense>
          </SectionErrorTitle>
          <SectionErrorDescription>{result.message}</SectionErrorDescription>
        </SectionErrorHeading>
      </SectionError>
    );
  }

  if (!result.signedIn) {
    return (
      <EpisodeReaction size={size}>
        <EpisodeReactionLogin
          href={buildLoginPath(locale, defaultLocale, returnTo)}
          ratingCount={ratingCount}
        >
          <EpisodeReactionName>
            <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
              <EpisodeReactionNameIdle>
                <Message message="host.episode.reaction.login_aria" />
              </EpisodeReactionNameIdle>
              <EpisodeReactionNameReaders message="host.episode.reaction.count_aria" />
            </Suspense>
          </EpisodeReactionName>
          <EpisodeReactionHeart />
          <EpisodeReactionCount />
        </EpisodeReactionLogin>
      </EpisodeReaction>
    );
  }

  return (
    <EpisodeReaction size={size}>
      <EpisodeReactionForm
        episodePublicId={episodePublicId}
        mode={result.mode}
        ratingCount={result.ratingCount}
        returnTo={returnTo}
        score={result.score}
        seriesPublicId={seriesPublicId}
        tenantId={tenantId}
      >
        <EpisodeReactionSubmit>
          <EpisodeReactionName>
            <Suspense fallback={<SkeletonLine className="h-4 w-52" />}>
              <EpisodeReactionNameIdle>
                <Message message="host.episode.reaction.press_aria" />
              </EpisodeReactionNameIdle>
              <EpisodeReactionNameProgress message="host.episode.reaction.press_progress_aria" />
              <EpisodeReactionNameDone>
                <Message message="host.episode.reaction.max_aria" />
              </EpisodeReactionNameDone>
              <EpisodeReactionNameReaders message="host.episode.reaction.count_aria" />
            </Suspense>
          </EpisodeReactionName>
          <EpisodeReactionHeart />
          <EpisodeReactionCount />
        </EpisodeReactionSubmit>
        <EpisodeReactionError />
      </EpisodeReactionForm>
    </EpisodeReaction>
  );
};
