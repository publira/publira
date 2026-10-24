import * as SectionError from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import { buildLoginPath } from "#lib/auth-shared";
import { getMyEpisodeRating } from "#lib/episode-rating";
import { getLocale } from "#lib/locale";
import { getTenantDefaultLocale } from "#lib/tenant";

import * as EpisodeReaction from "./episode-reaction";
import { LocaleField } from "./locale-field";

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
  episodeId,
  ratingCount,
  returnTo,
  seriesPublicId,
  size = "lg",
  tenantId,
}: {
  episodeId: string;
  ratingCount: number;
  returnTo: string;
  seriesPublicId: string;
  size?: EpisodeReaction.Size;
  tenantId: string;
}) => {
  const locale = await getLocale();
  const [defaultLocale, result] = await Promise.all([
    getTenantDefaultLocale(tenantId),
    getMyEpisodeRating(tenantId, episodeId, locale),
  ]);

  if (!result.ok) {
    return (
      <SectionError.Root className="max-w-sm">
        <SectionError.Heading>
          <SectionError.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="storefront.episode.reaction.status_error" />
            </Suspense>
          </SectionError.Title>
          <SectionError.Description>{result.message}</SectionError.Description>
        </SectionError.Heading>
      </SectionError.Root>
    );
  }

  // The API refuses a rating from a reader credited on the episode, so the
  // author is not offered a press that would end in that refusal.
  if (result.readerCredited) {
    return null;
  }

  if (!result.signedIn) {
    return (
      <EpisodeReaction.Root size={size}>
        <EpisodeReaction.Login
          href={buildLoginPath(locale, defaultLocale, returnTo)}
          ratingCount={ratingCount}
        >
          <EpisodeReaction.Name>
            <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
              <EpisodeReaction.NameIdle>
                <Message message="storefront.episode.reaction.login_aria" />
              </EpisodeReaction.NameIdle>
              <EpisodeReaction.NameReaders message="storefront.episode.reaction.count_aria" />
            </Suspense>
          </EpisodeReaction.Name>
          <EpisodeReaction.Heart />
          <EpisodeReaction.Count />
        </EpisodeReaction.Login>
      </EpisodeReaction.Root>
    );
  }

  return (
    <EpisodeReaction.Root size={size}>
      <EpisodeReaction.Form
        mode={result.mode}
        ratingCount={result.ratingCount}
        score={result.score}
      >
        <LocaleField />
        <input name="episodeId" type="hidden" value={episodeId} />
        <input name="returnTo" type="hidden" value={returnTo} />
        <input name="seriesPublicId" type="hidden" value={seriesPublicId} />
        <input name="tenantId" type="hidden" value={tenantId} />
        <EpisodeReaction.Submit>
          <EpisodeReaction.Name>
            <Suspense fallback={<SkeletonLine className="h-4 w-52" />}>
              <EpisodeReaction.NameIdle>
                <Message message="storefront.episode.reaction.press_aria" />
              </EpisodeReaction.NameIdle>
              <EpisodeReaction.NameProgress message="storefront.episode.reaction.press_progress_aria" />
              <EpisodeReaction.NameDone>
                <Message message="storefront.episode.reaction.max_aria" />
              </EpisodeReaction.NameDone>
              <EpisodeReaction.NameReaders message="storefront.episode.reaction.count_aria" />
            </Suspense>
          </EpisodeReaction.Name>
          <EpisodeReaction.Heart />
          <EpisodeReaction.Count />
        </EpisodeReaction.Submit>
        <EpisodeReaction.Error />
      </EpisodeReaction.Form>
    </EpisodeReaction.Root>
  );
};
