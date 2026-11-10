import type { Locale } from "@publira/i18n";
import { formatDateTime, formatPrice } from "@publira/utils";
import type { JSX } from "react";

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
import type { SubscriptionPaymentData } from "./subscription-payment";

export interface SubscriptionRenewedEmailProps {
  data: SubscriptionPaymentData;
  locale: Locale;
  messages: Messages;
  timeZone: string;
}

export const subscriptionRenewedPreview = (
  data: SubscriptionPaymentData,
  messages: Messages
): string =>
  emailMessage(messages, "email.subscription_renewed.preview", {
    plan_name: data.plan_name,
  });

/**
 * The mail a reader is sent when a later invoice of their subscription is paid
 * for a new period. It states what the started mail states, about the period
 * this payment covers: the plan, the price paid with its currency by code
 * beside the symbol, and the period, whose end is when the plan's episodes stay
 * open until and when the plan renews next. The button opens My Page, where
 * Manage billing manages the subscription. A renewal in the provider's test
 * mode says it charged nothing.
 */
export const SubscriptionRenewedEmail = ({
  data,
  locale,
  messages,
  timeZone,
}: SubscriptionRenewedEmailProps): JSX.Element => {
  const periodEnd = formatDateTime(data.period_end, { locale, timeZone });

  return (
    <EmailLayout
      brand={data.tenant_name}
      locale={locale}
      messages={messages}
      preview={subscriptionRenewedPreview(data, messages)}
    >
      <EmailHeading>
        {emailMessage(messages, "email.subscription_renewed.heading")}
      </EmailHeading>
      <EmailIntro>
        {emailMessage(messages, "email.subscription_renewed.intro", {
          tenant_name: data.tenant_name,
        })}
      </EmailIntro>
      {data.is_test ? (
        <EmailMeta>
          {emailMessage(messages, "email.subscription_renewed.test_notice")}
        </EmailMeta>
      ) : null}
      <EmailDetail>
        {emailMessage(messages, "email.subscription_renewed.plan", {
          plan_name: data.plan_name,
        })}
      </EmailDetail>
      <EmailDetail>
        {emailMessage(messages, "email.subscription_renewed.amount", {
          amount: formatPrice(data.amount, { currency: data.currency, locale }),
          currency: data.currency,
        })}
      </EmailDetail>
      <EmailDetail>
        {emailMessage(messages, "email.subscription_renewed.period", {
          period_end: periodEnd,
          period_start: formatDateTime(data.period_start, { locale, timeZone }),
        })}
      </EmailDetail>
      <EmailBody>
        {emailMessage(messages, "email.subscription_renewed.open_until", {
          period_end: periodEnd,
        })}
      </EmailBody>
      <EmailBody>
        {emailMessage(messages, "email.subscription_renewed.manage")}
      </EmailBody>
      <EmailButton href={data.my_page_url}>
        {emailMessage(messages, "email.subscription_renewed.action")}
      </EmailButton>
      <EmailFallbackLink href={data.my_page_url}>
        {emailMessage(messages, "email.subscription_renewed.fallback_link")}
      </EmailFallbackLink>
    </EmailLayout>
  );
};
