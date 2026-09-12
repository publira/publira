import { getMessage, toIntlLocale } from "@publira/i18n";
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
import { getLocale, loadHostMessages } from "#lib/locale";
import { getTenantDefaultLocale } from "#lib/tenant";

import type { EpisodeReactionSize } from "./episode-reaction";
import { EpisodeReactionHeart, EpisodeReactionLogin } from "./episode-reaction";
import { EpisodeReactionButton } from "./episode-reaction-button";

/**
 * Member-specific reaction island. The surrounding episode body stays on the
 * public cache; this component must sit inside its own `<Suspense>` so the
 * session cookie does not personalize the static shell.
 *
 * It fills the compound face — heart and headcount as slots — after the
 * private read. The headcount a guest sees is the one the cached episode
 * read already carried. A signed-in reader's own score is a private read
 * next to the follow state, and that same read is what the control takes
 * the live headcount from once they are signed in.
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
  const [defaultLocale, result, messages] = await Promise.all([
    getTenantDefaultLocale(tenantId),
    getMyEpisodeRating(tenantId, episodePublicId, locale),
    loadHostMessages(locale),
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
    const count = ratingCount.toLocaleString(toIntlLocale(locale));
    const countLabel = getMessage(
      messages,
      "host.episode.reaction.count_aria",
      { count }
    );
    return (
      <EpisodeReactionLogin
        aria-label={`${getMessage(messages, "host.episode.reaction.login_aria")}. ${countLabel}`}
        href={buildLoginPath(locale, defaultLocale, returnTo)}
        size={size}
      >
        <EpisodeReactionHeart />
        {count}
      </EpisodeReactionLogin>
    );
  }

  return (
    <EpisodeReactionButton
      copy={{
        countAria: getMessage(messages, "host.episode.reaction.count_aria"),
        maxAria: getMessage(messages, "host.episode.reaction.max_aria"),
        pressAria: getMessage(messages, "host.episode.reaction.press_aria"),
        pressProgressAria: getMessage(
          messages,
          "host.episode.reaction.press_progress_aria"
        ),
      }}
      episodePublicId={episodePublicId}
      mode={result.mode}
      ratingCount={result.ratingCount}
      returnTo={returnTo}
      score={result.score}
      seriesPublicId={seriesPublicId}
      size={size}
      tenantId={tenantId}
    />
  );
};
