"use client";

import * as Combobox from "@publira/ui-components/combobox";
import { useState } from "react";
import type { ReactNode } from "react";

/**
 * A currency chosen by searching `items`, posted as `name`. `children` is the
 * popup, written where the form is composed.
 *
 * A disabled field posts nothing, which the API reads as keeping the stored
 * currency: that is how a locked one is shown without being sent back.
 */
export const CurrencyCombobox = ({
  children,
  disabled = false,
  initialCurrency,
  items,
  name,
  placeholder,
}: {
  children: ReactNode;
  disabled?: boolean;
  /** Empty when there is no currency to start on. */
  initialCurrency: string;
  items: readonly Combobox.Item[];
  name: string;
  placeholder?: string;
}) => {
  const [currency, setCurrency] = useState(initialCurrency);

  return (
    <>
      {disabled ? null : <input name={name} type="hidden" value={currency} />}
      <Combobox.Root
        disabled={disabled}
        items={items}
        onValueChange={setCurrency}
        value={currency}
      >
        <Combobox.Input placeholder={placeholder} />
        {children}
      </Combobox.Root>
    </>
  );
};
