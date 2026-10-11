import { episodePath } from "./episode-path";

export const episodeLoginHref = (
  seriesPublicId: string,
  episodePublicId: string
): string => {
  const returnTo = episodePath(seriesPublicId, episodePublicId);
  return `/login?returnTo=${encodeURIComponent(returnTo)}`;
};
