/**
 * The rules the tenant's tip amounts are held to, as the Go server holds them
 * in `normalizeTipSettings`: none to six amounts in the tenant's currency, each
 * above 0 and none repeated, and at least one while tips are on. The tips card
 * checks each field once the operator leaves it and the Server Action checks
 * the list again before it is sent, so an operator is told which amount is
 * wrong without a round trip. The server stays the authority.
 *
 * Kept apart from `tenant-purchase-settings.ts` because the tips card is a
 * Client Component: importing from the module that reads the session would
 * pull `next/headers` into the browser graph.
 */

import { MAX_INT32 } from "./int32";
import { parsePriceInput } from "./price";

/** The most amounts a tenant may offer, which the database holds it to too. */
export const MAX_TIP_AMOUNTS = 6;

/**
 * An amount typed in `currency`, read into the integer of its minor unit, or
 * `null` when it is no amount a reader could give: not a price, 0, or past
 * what the API's `int32` holds.
 */
export const parseTipAmount = (
  value: string,
  currency: string
): number | null => {
  const amount = parsePriceInput(value, currency);

  return amount !== null && amount > 0 && amount <= MAX_INT32 ? amount : null;
};

export type TipAmountsResult =
  | {
      ok: true;
      /** The amounts in ascending order, as the server stores them. */
      amounts: number[];
    }
  /** `amount` is the field's text, trimmed, for the message to quote. */
  | { ok: false; reason: "amount_invalid" | "duplicate"; amount: string }
  | { ok: false; reason: "none_while_enabled" | "too_many" };

/**
 * The amounts the fields hold, as the server would take them. A blank field
 * is no amount; anything else has to be one.
 */
export const parseTipAmounts = (
  values: readonly string[],
  currency: string,
  enabled: boolean
): TipAmountsResult => {
  const amounts = new Set<number>();

  for (const value of values) {
    const text = value.trim();

    if (text === "") {
      continue;
    }

    const amount = parseTipAmount(text, currency);

    if (amount === null) {
      return { amount: text, ok: false, reason: "amount_invalid" };
    }

    if (amounts.has(amount)) {
      return { amount: text, ok: false, reason: "duplicate" };
    }

    amounts.add(amount);
  }

  if (amounts.size > MAX_TIP_AMOUNTS) {
    return { ok: false, reason: "too_many" };
  }

  if (enabled && amounts.size === 0) {
    return { ok: false, reason: "none_while_enabled" };
  }

  return { amounts: [...amounts].toSorted((a, b) => a - b), ok: true };
};
