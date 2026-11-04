"use client";

import * as ActionForm from "@publira/ui-components/action-form";
import * as Field from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Switch } from "@publira/ui-components/switch";
import { useState } from "react";

import { ClientMessage, useClientMessages } from "#components/client-message";
import * as EntryList from "#components/entry-list";
import {
  maxPriceInputValue,
  priceInputStep,
  toPriceInputValue,
} from "#lib/price";
import type { TenantTipSettings } from "#lib/tenant-purchase-settings";
import {
  MAX_TIP_AMOUNTS,
  parseTipAmount,
  parseTipAmounts,
} from "#lib/tenant-tip-settings-shared";

import type { TenantTipSettingsFormState } from "../payment-types";

type SettledState = NonNullable<TenantTipSettingsFormState>;

/**
 * One amount, named once the operator has left its field: one that is no
 * amount above 0, or one an earlier field already holds.
 */
const TipAmountEntry = ({ currency }: { currency: string }) => {
  const t = useClientMessages();
  const { position, touched, value } = EntryList.useRow();
  const values = EntryList.useValues();
  const text = value.trim();
  const amount = parseTipAmount(text, currency);

  let message: string | undefined;

  if (touched && text !== "") {
    if (amount === null) {
      message = t("admin.settings.tips.validation.amount_invalid", {
        amount: text,
      });
    } else if (
      values
        .slice(0, Number(position) - 1)
        .some((earlier) => parseTipAmount(earlier.trim(), currency) === amount)
    ) {
      message = t("admin.settings.tips.validation.amount_duplicate", {
        amount: text,
      });
    }
  }

  return (
    <>
      <EntryList.Field invalid={message !== undefined}>
        <EntryList.Input
          aria-label={t("admin.settings.tips.amount_label", { position })}
          inputMode="decimal"
          max={maxPriceInputValue(currency)}
          name="tip_amounts"
          step={priceInputStep(currency)}
          type="number"
        />
        {message === undefined ? null : (
          <FormMessage variant="destructive">{message}</FormMessage>
        )}
      </EntryList.Field>
      <EntryList.Remove
        aria-label={t("admin.settings.tips.amount_remove", { position })}
      />
    </>
  );
};

/** A list longer than the server keeps, or the refusal of the last save. */
const TipAmountsMessage = ({
  currency,
  enabled,
}: {
  currency: string;
  enabled: boolean;
}) => {
  const t = useClientMessages();
  const state = ActionForm.useState<SettledState>();
  const list = parseTipAmounts(EntryList.useValues(), currency, enabled);

  if (!list.ok && list.reason === "too_many") {
    return (
      <EntryList.Message>
        {t("admin.settings.tips.validation.too_many", {
          max: MAX_TIP_AMOUNTS,
        })}
      </EntryList.Message>
    );
  }

  return (
    <EntryList.Message>
      {state?.ok === false ? state.fieldErrors?.tipAmounts : undefined}
    </EntryList.Message>
  );
};

interface TenantTipSettingsFieldsProps {
  /** The ISO 4217 code of the currency the amounts are entered in. */
  currency: string;
  initialSettings: TenantTipSettings;
}

/**
 * The switch and the amounts, one per field. Each field is checked once the
 * operator leaves it, with the rules the server applies, so an amount it would
 * refuse is named before the round trip. The caller remounts the fields on
 * what a save stored, in ascending order.
 */
export const TenantTipSettingsFields = ({
  currency,
  initialSettings,
}: TenantTipSettingsFieldsProps) => {
  const [enabled, setEnabled] = useState(initialSettings.enabled);

  return (
    <>
      <Field.Root className="grid-cols-[auto_1fr] items-start gap-x-3">
        <Switch
          checked={enabled}
          className="row-span-2 mt-0.5"
          name="tips_enabled"
          onCheckedChange={setEnabled}
        />
        <Field.Label>
          <ClientMessage message="admin.settings.tips.enabled" />
        </Field.Label>
        <Field.Description className="col-start-2">
          <ClientMessage message="admin.settings.tips.enabled_description" />
        </Field.Description>
      </Field.Root>

      <input name="tip_amounts_currency" type="hidden" value={currency} />

      <EntryList.Root
        initialEntries={initialSettings.amounts.map((amount) =>
          toPriceInputValue(amount, currency)
        )}
      >
        <EntryList.Legend>
          <ClientMessage message="admin.settings.tips.amounts" />
        </EntryList.Legend>
        <EntryList.Rows>
          <TipAmountEntry currency={currency} />
        </EntryList.Rows>
        <EntryList.Add>
          <ClientMessage message="admin.settings.tips.amounts_add" />
        </EntryList.Add>
        <EntryList.Description>
          <ClientMessage
            message="admin.settings.tips.amounts_description"
            values={{ currency, max: MAX_TIP_AMOUNTS }}
          />
        </EntryList.Description>
        <TipAmountsMessage currency={currency} enabled={enabled} />
      </EntryList.Root>
    </>
  );
};
