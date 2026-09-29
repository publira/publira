"use client";

import { Combobox, ComboboxInput } from "@publira/ui-components/combobox";
import type { ComboboxItem } from "@publira/ui-components/combobox";
import { listSupportedTimeZones } from "@publira/utils";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import { useClientMessages } from "#components/client-message";

/**
 * The zone the form saves, chosen by searching the runtime's list. `children`
 * is the popup, written where the form is composed.
 */
export const PlatformTimezoneCombobox = ({
  children,
  disabled,
  initialTimezone,
}: {
  children: ReactNode;
  disabled: boolean;
  initialTimezone: string;
}) => {
  const [timezone, setTimezone] = useState(initialTimezone);
  const t = useClientMessages();

  const items = useMemo<ComboboxItem[]>(() => {
    const zones = listSupportedTimeZones();
    // A stored alias (`Asia/Calcutta`) is valid but is not always enumerated by
    // the runtime's ICU build, so keep it selectable instead of dropping it.
    const values =
      !initialTimezone || zones.includes(initialTimezone)
        ? zones
        : [initialTimezone, ...zones];

    return values.map((zone) => ({ label: zone, value: zone }));
  }, [initialTimezone]);

  return (
    <>
      <input name="default_timezone" type="hidden" value={timezone} />
      <Combobox
        disabled={disabled}
        items={items}
        onValueChange={setTimezone}
        value={timezone}
      >
        <ComboboxInput
          placeholder={t("platform.settings.default_timezone_placeholder")}
        />
        {children}
      </Combobox>
    </>
  );
};
