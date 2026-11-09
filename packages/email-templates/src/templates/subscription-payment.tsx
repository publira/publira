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

/**
 * The mails about a paid invoice of a subscription: the one that started it,
 * and each one after it, which paid for a new period. They state the same
 * things and differ only in their copy, whose namespace under `email.*` is the
 * template's ID.
 */
export type SubscriptionPaymentTemplate =
  | "subscription_renewed"
  | "subscription_started";

export interface SubscriptionPaymentEmailProps {
  data: SubscriptionPaymentData;
  locale: Locale;
  messages: Messages;
  template: SubscriptionPaymentTemplate;
  timeZone: string;
}

export const subscriptionPaymentPreview =
  (template: SubscriptionPaymentTemplate) =>
  (data: SubscriptionPaymentData, messages: Messages): string =>
    emailMessage(messages, `email.${template}.preview`, {
      plan_name: data.plan_name,
    });

/**
 * The mail a reader is sent when an invoice of their subscription is paid. It
 * names the plan, the price paid with its currency by code beside the symbol,
 * as the receipt does, and the period that payment covers, whose end is when
 * the plan's episodes stay open until and when the plan renews next. The
 * reader manages the subscription from Manage billing on My Page, which the
 * button opens. An invoice paid in the provider's test mode says it charged
 * nothing.
 */
export const SubscriptionPaymentEmail = ({
  data,
  locale,
  messages,
  template,
  timeZone,
}: SubscriptionPaymentEmailProps): JSX.Element => {
  const periodEnd = formatDateTime(data.period_end, { locale, timeZone });

  return (
    <EmailLayout
      brand={data.tenant_name}
      locale={locale}
      messages={messages}
      preview={subscriptionPaymentPreview(template)(data, messages)}
    >
      <EmailHeading>
        {emailMessage(messages, `email.${template}.heading`)}
      </EmailHeading>
      <EmailIntro>
        {emailMessage(messages, `email.${template}.intro`, {
          tenant_name: data.tenant_name,
        })}
      </EmailIntro>
      {data.is_test ? (
        <EmailMeta>
          {emailMessage(messages, `email.${template}.test_notice`)}
        </EmailMeta>
      ) : null}
      <EmailDetail>
        {emailMessage(messages, `email.${template}.plan`, {
          plan_name: data.plan_name,
        })}
      </EmailDetail>
      <EmailDetail>
        {emailMessage(messages, `email.${template}.amount`, {
          amount: formatPrice(data.amount, { currency: data.currency, locale }),
          currency: data.currency,
        })}
      </EmailDetail>
      <EmailDetail>
        {emailMessage(messages, `email.${template}.period`, {
          period_end: periodEnd,
          period_start: formatDateTime(data.period_start, { locale, timeZone }),
        })}
      </EmailDetail>
      <EmailBody>
        {emailMessage(messages, `email.${template}.open_until`, {
          period_end: periodEnd,
        })}
      </EmailBody>
      <EmailBody>
        {emailMessage(messages, `email.${template}.manage`)}
      </EmailBody>
      <EmailButton href={data.my_page_url}>
        {emailMessage(messages, `email.${template}.action`)}
      </EmailButton>
      <EmailFallbackLink href={data.my_page_url}>
        {emailMessage(messages, `email.${template}.fallback_link`)}
      </EmailFallbackLink>
    </EmailLayout>
  );
};
