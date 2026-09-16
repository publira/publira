import type { EpisodeDetail } from "#lib/catalog";
import type { HostMessageAccessor } from "#lib/messages";

/**
 * How an episode names itself where it stands as one string and the work is
 * not around it: the document title, the card a link unfurls into, and the text
 * a share sheet hands over. The running head on the page says the same thing,
 * as two elements rather than one string, so the number keeps its own tabular
 * figures there.
 */
export const episodeDisplayTitle = (
  t: HostMessageAccessor,
  episode: Pick<EpisodeDetail, "orderIndex" | "title">
): string =>
  `${t("host.common.episode_number", { number: episode.orderIndex })} ${episode.title}`;
