import { getMessage } from "@publira/i18n";
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

import {
  EpisodeReactionButton,
  EpisodeReactionLoginLink,
} from "./episode-reaction-button";
import type { EpisodeReactionControlSize } from "./episode-reaction-button";

/**
 * Member-specific reaction island. The surrounding episode body stays on the
 * public cache; this component must sit inside its own `<Suspense>` so the
 * session cookie does not personalize the static shell.
 *
 * The headcount a guest sees is the one the cached episode read already
 * carried. A signed-in reader's own score is a private read next to the
 * follow state, and that same read is what the control takes the live
 * headcount from once they are signed in.
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
  size?: EpisodeReactionControlSize;
  tenantId: string;
}) => {
  const locale = await getLocale();
  const [defaultLocale, result, messages] = await Promise.all([
    getTenantDefaultLocale(tenantId),
    getMyEpisodeRating(tenantId, episodePublicId, locale),
    loadHostMessages(locale),
  ]);

  const copy = {
    countAria: getMessage(messages, "host.episode.reaction.count_aria"),
    loginAria: getMessage(messages, "host.episode.reaction.login_aria"),
    maxAria: getMessage(messages, "host.episode.reaction.max_aria"),
    pressAria: getMessage(messages, "host.episode.reaction.press_aria"),
    pressProgressAria: getMessage(
      messages,
      "host.episode.reaction.press_progress_aria"
    ),
  };

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
      <EpisodeReactionLoginLink
        copy={copy}
        href={buildLoginPath(locale, defaultLocale, returnTo)}
        ratingCount={ratingCount}
        size={size}
      />
    );
  }

  return (
    <EpisodeReactionButton
      copy={copy}
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
