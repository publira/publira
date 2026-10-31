import type { Locale } from "@publira/i18n";

import { boundedIntFormSchema } from "./form-schemas";
import { MAX_INT32 } from "./int32";
import { getMessagesFor } from "./messages";
import { priceFormSchema } from "./price";

export type EpisodeRentalResult =
  /** Both 0 for an episode that is not rented. */
  | { ok: true; rentalPrice: number; rentalPeriodHours: number }
  | { ok: false; message: string };

/**
 * The rental a form states beside the permanent copy's `price`, read in the
 * `currency` that price was read in and checked as the API checks it, so the
 * operator is told which field to fix before anything is sent.
 *
 * The rental price is what decides whether the episode is rented: a blank one
 * is no rental, and the period is then left unsent, since the form starts that
 * field at the series' rental period whether or not the operator rents the
 * episode. A rental price states a rental, which needs a period of at least an
 * hour and has to cost less than the permanent copy — which also keeps a free
 * episode from being rented.
 */
export const parseEpisodeRental = async (
  input: {
    price: number;
    currency: string;
    rentalPrice: string;
    rentalPeriodHours: string;
  },
  locale: Locale
): Promise<EpisodeRentalResult> => {
  if (input.rentalPrice.trim() === "") {
    return { ok: true, rentalPeriodHours: 0, rentalPrice: 0 };
  }

  const t = await getMessagesFor(locale);

  const rentalPrice = priceFormSchema(
    input.currency,
    t("admin.series.episodes.validation.rental_price_invalid")
  ).safeParse(input.rentalPrice);

  if (!rentalPrice.success || rentalPrice.data <= 0) {
    return {
      message: t("admin.series.episodes.validation.rental_price_invalid"),
      ok: false,
    };
  }

  if (rentalPrice.data >= input.price) {
    return {
      message: t("admin.series.episodes.validation.rental_price_not_cheaper"),
      ok: false,
    };
  }

  // A whole number as typed: a fraction of an hour is refused rather than
  // rounded down to a period the operator did not set.
  const rentalPeriodHours = boundedIntFormSchema(
    t("admin.series.episodes.validation.rental_period_invalid"),
    { max: MAX_INT32, min: 1 }
  ).safeParse(input.rentalPeriodHours);

  if (!rentalPeriodHours.success) {
    return {
      message: t("admin.series.episodes.validation.rental_period_invalid"),
      ok: false,
    };
  }

  return {
    ok: true,
    rentalPeriodHours: rentalPeriodHours.data,
    rentalPrice: rentalPrice.data,
  };
};
