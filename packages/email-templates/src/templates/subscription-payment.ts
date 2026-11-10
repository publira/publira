import { listSupportedCurrencies, parseInstant } from "@publira/utils";
import { z } from "zod";

import {
  catalogTitleField,
  displayNameField,
  httpUrlField,
  instantField,
} from "./fields";

/**
 * The data of the mails about a paid invoice of a subscription: the one that
 * started it, and each one after it, which paid for a new period. The two mails
 * state the same things and differ only in their copy.
 */
export const subscriptionPaymentDataSchema: z.ZodObject<
  {
    amount: z.ZodNumber;
    currency: z.ZodString;
    is_test: z.ZodBoolean;
    my_page_url: z.ZodString;
    period_end: z.ZodString;
    period_start: z.ZodString;
    plan_name: z.ZodString;
    tenant_name: z.ZodString;
  },
  z.core.$strip
> = z
  .object({
    /** The price the invoice paid, an integer in the minor unit of `currency`. */
    amount: z
      .number()
      .int({ error: "amount must be an integer in the minor unit" })
      .min(1, { error: "amount must be more than nothing" }),
    currency: z
      .string()
      .trim()
      .refine((value) => listSupportedCurrencies().includes(value), {
        error: "currency must be an ISO 4217 code",
      }),
    /** Whether the invoice was paid in the payment provider's test mode. */
    is_test: z.boolean({ error: "is_test must be a boolean" }),
    /** My Page on the site, where Manage billing opens the provider's billing page. */
    my_page_url: httpUrlField("my_page_url"),
    /**
     * The half-open period the invoice paid for. Its end is when the plan
     * renews next, the date My Page shows.
     */
    period_end: instantField("period_end"),
    period_start: instantField("period_start"),
    plan_name: catalogTitleField("plan_name"),
    tenant_name: displayNameField("tenant_name"),
  })
  .refine(
    (data) => {
      const start = parseInstant(data.period_start);
      const end = parseInstant(data.period_end);

      return (
        start !== null &&
        end !== null &&
        Temporal.Instant.compare(start, end) < 0
      );
    },
    { error: "period_end must come after period_start" }
  );

export type SubscriptionPaymentData = z.output<
  typeof subscriptionPaymentDataSchema
>;
