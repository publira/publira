/**
 * How a pack checkout the site could not start ends: `unavailable` for a pack
 * taken off sale or a tenant that stopped selling packs or taking payments,
 * and `error` for anything else.
 */
export type CoinPackCheckoutOutcome = "error" | "unavailable";

/**
 * `/my/coins`, the reader's coins, with the outcome a pack checkout started
 * from it ended in. The checkout itself sends the reader back here with its
 * own `checkout` and `coin_pack` parameters.
 */
export const coinsPagePath = (outcome?: CoinPackCheckoutOutcome): string =>
  outcome ? `/my/coins?checkout=${outcome}` : "/my/coins";

/**
 * What an episode's gate tells a reader whose coins it could not use: a pack
 * checkout that could not be started, a payment that failed, or a price that
 * changed after the gate showed it.
 */
export type EpisodeCoinsOutcome =
  | "pack_error"
  | "pack_unavailable"
  | "pay_error"
  | "price_changed";

/**
 * An episode, locale-less, with the outcome of what its gate did with the
 * reader's coins.
 */
export const episodeCoinsPath = (
  seriesPublicId: string,
  episodePublicId: string,
  outcome?: EpisodeCoinsOutcome
): string => {
  const path = `/series/${seriesPublicId}/episodes/${episodePublicId}`;

  return outcome ? `${path}?coins=${outcome}` : path;
};
