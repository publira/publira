import type { Locale } from "@publira/i18n";
import {
  formatDateTime,
  formatPrice,
  listSupportedCurrencies,
  parseInstant,
} from "@publira/utils";
import type { JSX } from "react";
import { z } from "zod";

import { EmailButton } from "../button";
import { EmailLayout } from "../layout";
import { emailMessage } from "../messages";
import type { Messages } from "../messages";
import {
  EmailBody,
  EmailDetail,
  EmailFallbackLink,
  EmailHeading,
  EmailIntro,
  EmailMeta,
} from "../text";
import {
  catalogTitleField,
  displayNameField,
  httpUrlField,
  instantField,
} from "./fields";

export const subscriptionStartedDataSchema: z.ZodObject<
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
    /** The price the first payment paid, an integer in the minor unit of `currency`. */
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
    /** Whether the subscription was started in the payment provider's test mode. */
    is_test: z.boolean({ error: "is_test must be a boolean" }),
    /** My Page on the site, where Manage billing opens the provider's billing page. */
    my_page_url: httpUrlField("my_page_url"),
    /**
     * The half-open period the first payment paid for. Its end is when the
     * plan renews, the date My Page shows.
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

export type SubscriptionStartedData = z.output<
  typeof subscriptionStartedDataSchema
>;

export interface SubscriptionStartedEmailProps {
  data: SubscriptionStartedData;
  locale: Locale;
  messages: Messages;
  timeZone: string;
}

export const subscriptionStartedPreview = (
  data: SubscriptionStartedData,
  messages: Messages
): string =>
  emailMessage(messages, "email.subscription_started.preview", {
    plan_name: data.plan_name,
  });

/**
 * The mail a reader is sent when the first payment of their subscription goes
 * through. It names the plan, the price paid with its currency by code beside
 * the symbol, as the receipt does, and the period that payment covers, whose
 * end is when the plan's episodes stay open until and when the plan renews.
 * The reader manages the subscription from Manage billing on My Page, which
 * the button opens. A subscription started in the provider's test mode says it
 * charged nothing.
 */
export const SubscriptionStartedEmail = ({
  data,
  locale,
  messages,
  timeZone,
}: SubscriptionStartedEmailProps): JSX.Element => {
  const periodEnd = formatDateTime(data.period_end, { locale, timeZone });

  return (
    <EmailLayout
      brand={data.tenant_name}
      locale={locale}
      messages={messages}
      preview={subscriptionStartedPreview(data, messages)}
    >
      <EmailHeading>
        {emailMessage(messages, "email.subscription_started.heading")}
      </EmailHeading>
      <EmailIntro>
        {emailMessage(messages, "email.subscription_started.intro", {
          tenant_name: data.tenant_name,
        })}
      </EmailIntro>
      {data.is_test ? (
        <EmailMeta>
          {emailMessage(messages, "email.subscription_started.test_notice")}
        </EmailMeta>
      ) : null}
      <EmailDetail>
        {emailMessage(messages, "email.subscription_started.plan", {
          plan_name: data.plan_name,
        })}
      </EmailDetail>
      <EmailDetail>
        {emailMessage(messages, "email.subscription_started.amount", {
          amount: formatPrice(data.amount, { currency: data.currency, locale }),
          currency: data.currency,
        })}
      </EmailDetail>
      <EmailDetail>
        {emailMessage(messages, "email.subscription_started.period", {
          period_end: periodEnd,
          period_start: formatDateTime(data.period_start, { locale, timeZone }),
        })}
      </EmailDetail>
      <EmailBody>
        {emailMessage(messages, "email.subscription_started.open_until", {
          period_end: periodEnd,
        })}
      </EmailBody>
      <EmailBody>
        {emailMessage(messages, "email.subscription_started.manage")}
      </EmailBody>
      <EmailButton href={data.my_page_url}>
        {emailMessage(messages, "email.subscription_started.action")}
      </EmailButton>
      <EmailFallbackLink href={data.my_page_url}>
        {emailMessage(messages, "email.subscription_started.fallback_link")}
      </EmailFallbackLink>
    </EmailLayout>
  );
};
