"use client";

import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { Select } from "@publira/ui-components/select";
import { useCallback, useId, useState } from "react";

import { ClientMessage, useClientMessages } from "#components/client-message";
import { isPurchaseAvailabilityOverride } from "#lib/purchase-availability";
import type { PurchaseAvailabilityOverride } from "#lib/purchase-availability";
import type { SurfaceAvailabilityValue } from "#lib/surface-availability";

/** The empty value is the episode following its series. */
export const EpisodePurchaseAvailabilityField = ({
  initialValue,
  seriesPurchaseAvailability,
}: {
  initialValue: PurchaseAvailabilityOverride;
  /**
   * Where the series sells, resolved through the tenant's default, for the
   * option that follows it. Absent when either read failed, and the option
   * then says only that it follows the series.
   */
  seriesPurchaseAvailability?: SurfaceAvailabilityValue;
}) => {
  const t = useClientMessages();
  const [value, setValue] = useState(() => initialValue);
  // `Select` renders a trigger rather than a Field control, so the label needs
  // an id to point at.
  const selectId = useId();

  const handleValueChange = useCallback((next: string) => {
    if (isPurchaseAvailabilityOverride(next)) {
      setValue(next);
    }
  }, []);

  let followSeries = t(
    "admin.series.episodes.purchase_availability.follow_series"
  );
  if (seriesPurchaseAvailability === "all") {
    followSeries = t(
      "admin.series.episodes.purchase_availability.follow_series_value",
      { availability: t("admin.series.availability.all") }
    );
  } else if (seriesPurchaseAvailability === "web") {
    followSeries = t(
      "admin.series.episodes.purchase_availability.follow_series_value",
      { availability: t("admin.series.availability.web") }
    );
  } else if (seriesPurchaseAvailability === "app") {
    followSeries = t(
      "admin.series.episodes.purchase_availability.follow_series_value",
      { availability: t("admin.series.availability.app") }
    );
  }

  return (
    <Field>
      <FieldLabel htmlFor={selectId}>
        <ClientMessage message="admin.series.episodes.purchase_availability.label" />
      </FieldLabel>
      <FieldContent>
        <Select
          id={selectId}
          items={[
            { label: followSeries, value: "" },
            { label: t("admin.series.availability.all"), value: "all" },
            { label: t("admin.series.availability.web"), value: "web" },
            { label: t("admin.series.availability.app"), value: "app" },
          ]}
          onValueChange={handleValueChange}
          value={value}
        />
        <input name="purchase_availability" type="hidden" value={value} />
        <FieldDescription>
          <ClientMessage message="admin.series.episodes.purchase_availability.field_description" />
        </FieldDescription>
      </FieldContent>
    </Field>
  );
};
