"use client";

import { ClientMessage, useClientMessages } from "#components/client-message";
import type { EpisodeCreditUnchangedReasonValue } from "#lib/episode";

import type {
  EpisodeCreditRangeOption,
  BulkEditEpisodeCreditsActionState,
} from "../episode-types";

/** Why the server left one episode alone, in the reader's language. */
const UnchangedReason = ({
  reason,
}: {
  reason: EpisodeCreditUnchangedReasonValue;
}) => {
  switch (reason) {
    case "already_credited": {
      return (
        <ClientMessage message="admin.series.episodes.credits.reason_already_credited" />
      );
    }
    case "not_credited": {
      return (
        <ClientMessage message="admin.series.episodes.credits.reason_not_credited" />
      );
    }
    case "credited_on_the_episode": {
      return (
        <ClientMessage message="admin.series.episodes.credits.reason_credited_on_the_episode" />
      );
    }
    default: {
      return (
        <ClientMessage message="admin.series.episodes.credits.reason_unspecified" />
      );
    }
  }
};

interface EpisodeCreditsRangeResultProps {
  episodes: readonly EpisodeCreditRangeOption[];
  result: Extract<BulkEditEpisodeCreditsActionState, { ok: true }>;
}

/**
 * What one bulk edit did: the episodes it wrote on, and the ones it left,
 * each with the reason the server gave. A skip is a guest or a deliberate
 * deviation, not an error, so it is listed rather than toasted away.
 */
export const EpisodeCreditsRangeResult = ({
  episodes,
  result,
}: EpisodeCreditsRangeResultProps) => {
  const t = useClientMessages();
  const titleById = new Map(
    episodes.map((episode) => [episode.publicId, episode.title])
  );
  const labelFor = (publicId: string): string =>
    titleById.get(publicId) ?? publicId;

  return (
    <div className="grid gap-4">
      {result.changedEpisodePublicIds.length === 0 ? (
        <p className="text-sm text-foreground">
          {t("admin.series.episodes.credits.result_none_changed")}
        </p>
      ) : (
        <section className="grid gap-2">
          <h3 className="text-sm font-medium text-foreground">
            {t("admin.series.episodes.credits.result_changed", {
              count: String(result.changedEpisodePublicIds.length),
            })}
          </h3>
          <ul className="grid gap-1 text-sm text-foreground">
            {result.changedEpisodePublicIds.map((publicId) => (
              <li key={publicId}>{labelFor(publicId)}</li>
            ))}
          </ul>
        </section>
      )}

      {result.unchangedEpisodes.length > 0 ? (
        <section className="grid gap-2">
          <h3 className="text-sm font-medium text-foreground">
            {t("admin.series.episodes.credits.result_unchanged", {
              count: String(result.unchangedEpisodes.length),
            })}
          </h3>
          <ul className="grid gap-1 text-sm text-foreground">
            {result.unchangedEpisodes.map((episode) => (
              <li key={episode.episodePublicId}>
                {labelFor(episode.episodePublicId)}
                {" — "}
                <UnchangedReason reason={episode.reason} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
};
