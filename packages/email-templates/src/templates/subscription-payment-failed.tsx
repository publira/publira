import type { Locale } from "@publira/i18n";
import {
  formatDateTime,
  formatPrice,
  listSupportedCurrencies,
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

/**
 * The data of the mail about an attempt to collect a subscription's invoice
 * that did not go through.
 */
export const subscriptionPaymentFailedDataSchema: z.ZodObject<
  {
    amount: z.ZodNumber;
    currency: z.ZodString;
    is_test: z.ZodBoolean;
    my_page_url: z.ZodString;
    next_attempt: z.ZodUnion<readonly [z.ZodLiteral<"">, z.ZodString]>;
    period_end: z.ZodString;
    plan_name: z.ZodString;
    tenant_name: z.ZodString;
  },
  z.core.$strip
> = z.object({
  /** What the invoice asks for, an integer in the minor unit of `currency`. */
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
  /** Whether the attempt was made in the payment provider's test mode. */
  is_test: z.boolean({ error: "is_test must be a boolean" }),
  /** My Page on the site, where Manage billing opens the provider's billing page. */
  my_page_url: httpUrlField("my_page_url"),
  /**
   * When the provider tries again, and empty when its notification named no
   * such time, which is no sign that the retries have ended.
   */
  next_attempt: z.union([z.literal(""), instantField("next_attempt")]),
  /**
   * The end of the subscription's current period: the latest the plan's
   * episodes stay open until while the payment is retried.
   */
  period_end: instantField("period_end"),
  plan_name: catalogTitleField("plan_name"),
  tenant_name: displayNameField("tenant_name"),
});

export type SubscriptionPaymentFailedData = z.output<
  typeof subscriptionPaymentFailedDataSchema
>;

export interface SubscriptionPaymentFailedEmailProps {
  data: SubscriptionPaymentFailedData;
  locale: Locale;
  messages: Messages;
  timeZone: string;
}

export const subscriptionPaymentFailedPreview = (
  data: SubscriptionPaymentFailedData,
  messages: Messages
): string =>
  emailMessage(messages, "email.subscription_payment_failed.preview", {
    plan_name: data.plan_name,
  });

/**
 * The mail a reader is sent when an attempt to collect the payment that renews
 * their subscription does not go through. It names the plan and what the
 * invoice asks for, with its currency by code beside the symbol, when the
 * payment is tried again where the provider said, and until when the plan's
 * episodes stay open at the latest: the end of the current period, which a
 * subscription the provider ends on its last attempt does not reach. The button opens My
 * Page, where Manage billing changes the card. An attempt in the provider's
 * test mode says no money is owed.
 */
export const SubscriptionPaymentFailedEmail = ({
  data,
  locale,
  messages,
  timeZone,
}: SubscriptionPaymentFailedEmailProps): JSX.Element => (
  <EmailLayout
    brand={data.tenant_name}
    locale={locale}
    messages={messages}
    preview={subscriptionPaymentFailedPreview(data, messages)}
  >
    <EmailHeading>
      {emailMessage(messages, "email.subscription_payment_failed.heading")}
    </EmailHeading>
    <EmailIntro>
      {emailMessage(messages, "email.subscription_payment_failed.intro", {
        tenant_name: data.tenant_name,
      })}
    </EmailIntro>
    {data.is_test ? (
      <EmailMeta>
        {emailMessage(
          messages,
          "email.subscription_payment_failed.test_notice"
        )}
      </EmailMeta>
    ) : null}
    <EmailDetail>
      {emailMessage(messages, "email.subscription_payment_failed.plan", {
        plan_name: data.plan_name,
      })}
    </EmailDetail>
    <EmailDetail>
      {emailMessage(messages, "email.subscription_payment_failed.amount", {
        amount: formatPrice(data.amount, { currency: data.currency, locale }),
        currency: data.currency,
      })}
    </EmailDetail>
    {data.next_attempt === "" ? null : (
      <EmailBody>
        {emailMessage(
          messages,
          "email.subscription_payment_failed.next_attempt",
          {
            next_attempt: formatDateTime(data.next_attempt, {
              locale,
              timeZone,
            }),
          }
        )}
      </EmailBody>
    )}
    <EmailBody>
      {emailMessage(messages, "email.subscription_payment_failed.open_until", {
        period_end: formatDateTime(data.period_end, { locale, timeZone }),
      })}
    </EmailBody>
    <EmailBody>
      {emailMessage(messages, "email.subscription_payment_failed.manage")}
    </EmailBody>
    <EmailButton href={data.my_page_url}>
      {emailMessage(messages, "email.subscription_payment_failed.action")}
    </EmailButton>
    <EmailFallbackLink href={data.my_page_url}>
      {emailMessage(
        messages,
        "email.subscription_payment_failed.fallback_link"
      )}
    </EmailFallbackLink>
  </EmailLayout>
);
