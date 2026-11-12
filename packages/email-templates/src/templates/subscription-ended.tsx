import type { Locale } from "@publira/i18n";
import { formatDateTime } from "@publira/utils";
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
} from "../text";
import {
  catalogTitleField,
  displayNameField,
  httpUrlField,
  instantField,
} from "./fields";

/** The data of the mail about a subscription that has ended. */
export const subscriptionEndedDataSchema: z.ZodObject<
  {
    ended_at: z.ZodString;
    plan_name: z.ZodString;
    plans_url: z.ZodString;
    tenant_name: z.ZodString;
  },
  z.core.$strip
> = z.object({
  /** When the payment provider ended the subscription. */
  ended_at: instantField("ended_at"),
  plan_name: catalogTitleField("plan_name"),
  /** The site's subscription plans, where the reader may subscribe again. */
  plans_url: httpUrlField("plans_url"),
  tenant_name: displayNameField("tenant_name"),
});

export type SubscriptionEndedData = z.output<
  typeof subscriptionEndedDataSchema
>;

export interface SubscriptionEndedEmailProps {
  data: SubscriptionEndedData;
  locale: Locale;
  messages: Messages;
  timeZone: string;
}

export const subscriptionEndedPreview = (
  data: SubscriptionEndedData,
  messages: Messages
): string =>
  emailMessage(messages, "email.subscription_ended.preview", {
    plan_name: data.plan_name,
  });

/**
 * The mail a reader is sent when their subscription is over, whoever ended it.
 * It names the plan and when it ended, and with it the plan's episodes, and the
 * button opens
 * site's subscription plans, where the reader may subscribe again.
 */
export const SubscriptionEndedEmail = ({
  data,
  locale,
  messages,
  timeZone,
}: SubscriptionEndedEmailProps): JSX.Element => (
  <EmailLayout
    brand={data.tenant_name}
    locale={locale}
    messages={messages}
    preview={subscriptionEndedPreview(data, messages)}
  >
    <EmailHeading>
      {emailMessage(messages, "email.subscription_ended.heading")}
    </EmailHeading>
    <EmailIntro>
      {emailMessage(messages, "email.subscription_ended.intro", {
        tenant_name: data.tenant_name,
      })}
    </EmailIntro>
    <EmailDetail>
      {emailMessage(messages, "email.subscription_ended.plan", {
        plan_name: data.plan_name,
      })}
    </EmailDetail>
    <EmailBody>
      {emailMessage(messages, "email.subscription_ended.ended", {
        ended_at: formatDateTime(data.ended_at, { locale, timeZone }),
      })}
    </EmailBody>
    <EmailBody>
      {emailMessage(messages, "email.subscription_ended.resubscribe")}
    </EmailBody>
    <EmailButton href={data.plans_url}>
      {emailMessage(messages, "email.subscription_ended.action")}
    </EmailButton>
    <EmailFallbackLink href={data.plans_url}>
      {emailMessage(messages, "email.subscription_ended.fallback_link")}
    </EmailFallbackLink>
  </EmailLayout>
);
