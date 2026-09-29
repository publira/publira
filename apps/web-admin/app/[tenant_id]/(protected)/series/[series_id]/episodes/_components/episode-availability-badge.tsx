"use client";

import { Badge } from "@publira/ui-components/badge";

import { ClientMessage } from "#components/client-message";
import { episodeShownOn } from "#lib/surface-availability";
import type {
  EpisodeAvailabilityOverride,
  SurfaceAvailabilityValue,
} from "#lib/surface-availability";

/**
 * Marks an episode that is not on both surfaces, so it is recognizable without
 * opening it.
 */
export const EpisodeAvailabilityBadge = ({
  override,
  seriesAvailability,
}: {
  override: EpisodeAvailabilityOverride;
  seriesAvailability: SurfaceAvailabilityValue;
}) => {
  const shownOn = episodeShownOn(seriesAvailability, override);
  if (shownOn === "all") {
    return null;
  }
  if (shownOn === "none") {
    return (
      <Badge tone="warning" variant="soft">
        <ClientMessage message="admin.series.availability.none" />
      </Badge>
    );
  }

  return (
    <Badge tone="muted" variant="soft">
      {shownOn === "web" ? (
        <ClientMessage message="admin.series.availability.web" />
      ) : (
        <ClientMessage message="admin.series.availability.app" />
      )}
    </Badge>
  );
};
