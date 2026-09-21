"use client";

import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Select } from "@publira/ui-components/select";
import type { SelectProps } from "@publira/ui-components/select";
import { useCallback, useId, useState } from "react";

import { ClientMessage, useClientMessages } from "#components/client-message";
import {
  episodeShownOn,
  isEpisodeAvailabilityOverride,
} from "#lib/surface-availability";
import type {
  EpisodeAvailabilityOverride,
  SurfaceAvailabilityValue,
} from "#lib/surface-availability";

/**
 * The first option names what the series is shown on, and says only that it
 * follows the series when that read failed.
 */
const EpisodeAvailabilitySelect = ({
  seriesAvailability,
  ...props
}: Omit<SelectProps, "items"> & {
  seriesAvailability?: SurfaceAvailabilityValue;
}) => {
  const t = useClientMessages();

  let followSeries = t("admin.series.episodes.availability.follow_series");
  if (seriesAvailability === "all") {
    followSeries = t("admin.series.episodes.availability.follow_series_value", {
      availability: t("admin.series.availability.all"),
    });
  } else if (seriesAvailability === "web") {
    followSeries = t("admin.series.episodes.availability.follow_series_value", {
      availability: t("admin.series.availability.web"),
    });
  } else if (seriesAvailability === "app") {
    followSeries = t("admin.series.episodes.availability.follow_series_value", {
      availability: t("admin.series.availability.app"),
    });
  }

  return (
    <Select
      {...props}
      items={[
        { label: followSeries, value: "" },
        { label: t("admin.series.availability.all"), value: "all" },
        { label: t("admin.series.availability.web"), value: "web" },
        { label: t("admin.series.availability.app"), value: "app" },
      ]}
    />
  );
};

/** The empty value is the episode following its series. */
export const EpisodeAvailabilityField = ({
  initialValue,
  seriesAvailability,
}: {
  initialValue: EpisodeAvailabilityOverride;
  /**
   * What the series is shown on, for the option that follows it. Absent when
   * that read failed, and the option then says only that it follows the
   * series.
   */
  seriesAvailability?: SurfaceAvailabilityValue;
}) => {
  const [value, setValue] = useState(() => initialValue);
  // `Select` renders a trigger rather than a Field control, so the label needs
  // an id to point at.
  const selectId = useId();

  const handleValueChange = useCallback((next: string) => {
    if (isEpisodeAvailabilityOverride(next)) {
      setValue(next);
    }
  }, []);

  const shownNowhere =
    seriesAvailability !== undefined &&
    episodeShownOn(seriesAvailability, value) === "none";

  return (
    <Field>
      <FieldLabel htmlFor={selectId}>
        <ClientMessage message="admin.series.episodes.availability.label" />
      </FieldLabel>
      <FieldContent>
        <EpisodeAvailabilitySelect
          id={selectId}
          onValueChange={handleValueChange}
          seriesAvailability={seriesAvailability}
          value={value}
        />
        <input name="availability" type="hidden" value={value} />
        <FieldDescription>
          <ClientMessage message="admin.series.episodes.availability.field_description" />
        </FieldDescription>
        {shownNowhere ? (
          <FormMessage variant="warning">
            <ClientMessage message="admin.series.episodes.availability.shown_nowhere" />
          </FormMessage>
        ) : null}
      </FieldContent>
    </Field>
  );
};
