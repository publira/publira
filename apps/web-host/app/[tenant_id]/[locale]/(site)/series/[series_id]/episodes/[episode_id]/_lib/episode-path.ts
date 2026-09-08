/**
 * The app-internal path of one episode: what every link to it is written
 * from, and what a stored `returnTo` holds. It carries no locale prefix —
 * `<LocaleLink>` and `withLocalePrefix` add that where the href is used.
 */
export const episodePath = (
  seriesPublicId: string,
  episodePublicId: string
): string => `/series/${seriesPublicId}/episodes/${episodePublicId}`;
