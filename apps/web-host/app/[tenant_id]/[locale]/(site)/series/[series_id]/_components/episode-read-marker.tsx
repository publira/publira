import { getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";

import { getLocale, loadHostMessages } from "#lib/locale";
import { getMySeriesProgress } from "#lib/reading-progress";

/**
 * The episodes of this series the reader has finished, or none of them when
 * that could not be established.
 *
 * A failure ends here rather than propagating. It is the same read the call to
 * action above the episode list makes, and that one sits in a boundary that
 * reports it, so nothing is lost by a row staying quiet; rethrowing would take
 * the whole episode list down over a decoration on one of its rows.
 */
const readFinishedEpisodes = async (
  tenantId: string,
  seriesPublicId: string,
  locale: Locale
): Promise<string[]> => {
  try {
    const result = await getMySeriesProgress(tenantId, seriesPublicId, locale);
    return result.ok ? result.finishedEpisodePublicIds : [];
  } catch {
    return [];
  }
};

/**
 * Marks one row of the series' episode list as an episode this reader has
 * already finished.
 *
 * It is a marker per row rather than one component drawing the whole list,
 * because each row is a link the shared series detail renders and the mark is
 * the reader's own; the call site puts each one in a `<Suspense fallback={null}>`
 * so the list itself never waits for the private read. All of them read the
 * same request-memoized answer as the call to action above the list, so the
 * page still makes that read once.
 *
 * A guest and a reader who has finished nothing render nothing: the row is
 * complete without the mark, and there is no useful thing to say in its place.
 */
export const EpisodeReadMarker = async ({
  episodePublicId,
  seriesPublicId,
  tenantId,
}: {
  episodePublicId: string;
  seriesPublicId: string;
  tenantId: string;
}) => {
  const locale = await getLocale();
  const [finishedEpisodePublicIds, messages] = await Promise.all([
    readFinishedEpisodes(tenantId, seriesPublicId, locale),
    loadHostMessages(locale),
  ]);

  if (!finishedEpisodePublicIds.includes(episodePublicId)) {
    return null;
  }

  return (
    <span className="rounded-full bg-muted px-2.5 py-0.5 text-sm font-medium text-muted-foreground">
      {getMessage(messages, "host.series.episode_finished")}
    </span>
  );
};
