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

export interface SubscriptionStartedEmailProps {
  data: SubscriptionPaymentData;
  locale: Locale;
  messages: Messages;
  timeZone: string;
}

export const subscriptionStartedPreview = (
  data: SubscriptionPaymentData,
  messages: Messages
): string =>
  emailMessage(messages, "email.subscription_started.preview", {
    plan_name: data.plan_name,
  });

/**
 * The mail a reader is sent when the first invoice of their subscription is
 * paid. It names the plan, the price paid with its currency by code beside the
 * symbol, as the receipt does, and the period that payment covers, whose end is
 * when the plan's episodes stay open until and when the plan renews. The reader
 * manages the subscription from Manage billing on My Page, which the button
 * opens. A subscription started in the provider's test mode says it charged
 * nothing.
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
