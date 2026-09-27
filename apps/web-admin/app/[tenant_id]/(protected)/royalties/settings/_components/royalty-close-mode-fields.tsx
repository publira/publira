"use client";

import { RadioGroup } from "@publira/ui-components/radio-group";
import type { RadioGroupProps } from "@publira/ui-components/radio-group";
import { Select } from "@publira/ui-components/select";
import { createContext, use, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { useClientMessages } from "#components/client-message";
import {
  isRoyaltyCloseMode,
  MAX_ROYALTY_AUTO_CLOSE_DAY,
} from "#lib/royalty-period";
import type { RoyaltyCloseMode, RoyaltyClosePolicy } from "#lib/royalty-period";

interface RoyaltyCloseModeContextValue {
  autoCloseDay: string | null;
  closeMode: RoyaltyCloseMode | undefined;
  setAutoCloseDay: (day: string | null) => void;
  setCloseMode: (mode: RoyaltyCloseMode) => void;
}

const RoyaltyCloseModeContext =
  createContext<RoyaltyCloseModeContextValue | null>(null);

const useRoyaltyCloseMode = () => {
  const context = use(RoyaltyCloseModeContext);
  if (!context) {
    throw new Error("Rendered outside a RoyaltyCloseModeScope.");
  }

  return context;
};

/**
 * Holds the mode and the day the form saves, so the day survives switching
 * back and forth while the day field comes and goes with the mode.
 */
export const RoyaltyCloseModeScope = ({
  children,
  initialPolicy,
}: {
  children: ReactNode;
  initialPolicy?: RoyaltyClosePolicy;
}) => {
  const [closeMode, setCloseMode] = useState(initialPolicy?.closeMode);
  const [autoCloseDay, setAutoCloseDay] = useState(
    initialPolicy?.autoCloseDay === undefined
      ? null
      : String(initialPolicy.autoCloseDay)
  );
  const context = useMemo(
    () => ({ autoCloseDay, closeMode, setAutoCloseDay, setCloseMode }),
    [autoCloseDay, closeMode]
  );

  return (
    <RoyaltyCloseModeContext value={context}>
      <input name="close_mode" type="hidden" value={closeMode ?? ""} />
      {children}
    </RoyaltyCloseModeContext>
  );
};

/** The mode picker; `items` carry the rendered wording of each mode. */
export const RoyaltyCloseModeRadioGroup = ({
  items,
}: {
  items: RadioGroupProps["items"];
}) => {
  const { closeMode, setCloseMode } = useRoyaltyCloseMode();

  return (
    <RadioGroup
      items={items}
      onValueChange={(value) => {
        if (isRoyaltyCloseMode(value)) {
          setCloseMode(value);
        }
      }}
      value={closeMode}
    />
  );
};

/** Renders the day field only while months are closed automatically. */
export const RoyaltyAutoCloseDayField = ({
  children,
}: {
  children: ReactNode;
}) => (useRoyaltyCloseMode().closeMode === "automatic" ? children : null);

export const RoyaltyAutoCloseDaySelect = () => {
  const t = useClientMessages();
  const { autoCloseDay, setAutoCloseDay } = useRoyaltyCloseMode();

  const dayItems = Array.from(
    { length: MAX_ROYALTY_AUTO_CLOSE_DAY },
    (_, index) => ({
      label: t("admin.settings.royalties.day_option", { day: index + 1 }),
      value: String(index + 1),
    })
  );

  return (
    <>
      <Select
        className="sm:max-w-48"
        items={dayItems}
        onValueChange={setAutoCloseDay}
        placeholder={t("admin.settings.royalties.day_placeholder")}
        value={autoCloseDay}
      />
      <input name="auto_close_day" type="hidden" value={autoCloseDay ?? ""} />
    </>
  );
};
