import type { HostMessageKey } from "#lib/locale";

export const episodeLoginHref = (
  seriesPublicId: string,
  episodePublicId: string
): string => {
  const returnTo = `/series/${seriesPublicId}/episodes/${episodePublicId}`;
  return `/login?returnTo=${encodeURIComponent(returnTo)}`;
};

/**
 * Which pair of catalog keys the gate shows. Keys rather than strings: the
 * branch is decided on the server, and the copy is still resolved through the
 * catalog at the point it is displayed.
 */
export const episodeAccessGateCopy = (
  signedIn: boolean,
  acceptsPayments: boolean
): { description: HostMessageKey; title: HostMessageKey } => {
  if (signedIn) {
    return {
      description: acceptsPayments
        ? "host.episode.gate.signed_in_payable_description"
        : "host.episode.gate.signed_in_unpayable_description",
      title: "host.episode.gate.signed_in_title",
    };
  }

  return {
    description: acceptsPayments
      ? "host.episode.gate.guest_payable_description"
      : "host.episode.gate.guest_unpayable_description",
    title: "host.episode.gate.guest_title",
  };
};
