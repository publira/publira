"use client";

import * as Combobox from "@publira/ui-components/combobox";
import { listSupportedTimeZones } from "@publira/utils";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import { useClientMessages } from "#components/client-message";

/**
 * The platform default zone, chosen by searching the runtime's list and posted
 * as `default_timezone`. `children` is the popup, written where the form is
 * composed. The General settings form and the setup form both offer it, so the
 * zone an operator can pick at setup is one they can pick again later.
 */
export const PlatformTimezoneCombobox = ({
  children,
  disabled = false,
  initialTimezone,
}: {
  children: ReactNode;
  disabled?: boolean;
  initialTimezone: string;
}) => {
  const [timezone, setTimezone] = useState(initialTimezone);
  const t = useClientMessages();

  const items = useMemo<Combobox.Item[]>(() => {
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
      <Combobox.Root
        disabled={disabled}
        items={items}
        onValueChange={setTimezone}
        value={timezone}
      >
        <Combobox.Input
          placeholder={t("platform.settings.default_timezone_placeholder")}
        />
        {children}
      </Combobox.Root>
    </>
  );
};
