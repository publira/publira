"use client";

import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { Select } from "@publira/ui-components/select";
import { useCallback, useId } from "react";

import { ClientMessage, useClientMessages } from "#components/client-message";
import { isPurchaseAvailabilityOverride } from "#lib/purchase-availability";
import type { PurchaseAvailabilityOverride } from "#lib/purchase-availability";
import type { SurfaceAvailabilityValue } from "#lib/surface-availability";

export const SeriesPurchaseAvailabilityField = ({
  onChange,
  tenantPurchaseAvailability,
  value,
}: {
  onChange: (next: PurchaseAvailabilityOverride) => void;
  /**
   * Where the tenant sells by default, for the option that follows it. Absent
   * when that read failed, and the option then says only that it follows the
   * tenant — a wrong value named there would be read as the tenant's own.
   */
  tenantPurchaseAvailability?: SurfaceAvailabilityValue;
  value: PurchaseAvailabilityOverride;
}) => {
  const t = useClientMessages();
  // `Select` renders a trigger rather than a Field control, so the label needs
  // an id to point at.
  const selectId = useId();

  let followTenant = t("admin.series.form.purchase_availability_follow_tenant");
  if (tenantPurchaseAvailability === "all") {
    followTenant = t(
      "admin.series.form.purchase_availability_follow_tenant_value",
      { availability: t("admin.series.availability.all") }
    );
  } else if (tenantPurchaseAvailability === "web") {
    followTenant = t(
      "admin.series.form.purchase_availability_follow_tenant_value",
      { availability: t("admin.series.availability.web") }
    );
  } else if (tenantPurchaseAvailability === "app") {
    followTenant = t(
      "admin.series.form.purchase_availability_follow_tenant_value",
      { availability: t("admin.series.availability.app") }
    );
  }

  const handleValueChange = useCallback(
    (next: string) => {
      if (isPurchaseAvailabilityOverride(next)) {
        onChange(next);
      }
    },
    [onChange]
  );

  return (
    <Field>
      <FieldLabel htmlFor={selectId}>
        <ClientMessage message="admin.series.form.purchase_availability" />
      </FieldLabel>
      <FieldContent>
        <Select
          id={selectId}
          items={[
            { label: followTenant, value: "" },
            { label: t("admin.series.availability.all"), value: "all" },
            { label: t("admin.series.availability.web"), value: "web" },
            { label: t("admin.series.availability.app"), value: "app" },
          ]}
          onValueChange={handleValueChange}
          value={value}
        />
        <input name="purchase_availability" type="hidden" value={value} />
        <FieldDescription>
          <ClientMessage message="admin.series.form.purchase_availability_description" />
        </FieldDescription>
      </FieldContent>
    </Field>
  );
};
