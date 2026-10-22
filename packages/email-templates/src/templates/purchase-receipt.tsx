import type { Locale } from "@publira/i18n";
import {
  formatDateTime,
  formatPrice,
  listSupportedCurrencies,
} from "@publira/utils";
import { z } from "zod";

import { EmailButton } from "../button";
import { EmailLayout } from "../layout";
import { emailMessage } from "../messages";
import type { Messages } from "../messages";
import "../temporal";
import {
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

export const purchaseReceiptDataSchema = z
  .object({
    /** The price paid, an integer in the minor unit of `currency`. */
    amount: z
      .number()
      .int({ error: "amount must be an integer in the minor unit" })
      .min(0, { error: "amount must not be negative" }),
    currency: z
      .string()
      .trim()
      .refine((value) => listSupportedCurrencies().includes(value), {
        error: "currency must be an ISO 4217 code",
      }),
    /**
     * What was bought is one episode, one volume, or the rest of a series: the
     * title of the episode or the volume bought is filled in, or the number of
     * episodes the rest of the series held, and the others are empty, 0, or
     * left out.
     */
    episode_title: z.string().trim().default(""),
    /** Empty for a purchase with no reading period. */
    expires_at: z.union([z.literal(""), instantField("expires_at")]),
    /** Whether the purchase was paid in the payment provider's test mode. */
    is_test: z.boolean({ error: "is_test must be a boolean" }),
    library_url: httpUrlField("library_url"),
    purchased_at: instantField("purchased_at"),
    series_bundle_episode_count: z
      .number()
      .int({ error: "series_bundle_episode_count must be an integer" })
      .min(0, { error: "series_bundle_episode_count must not be negative" })
      .default(0),
    series_title: catalogTitleField("series_title"),
    tenant_name: displayNameField("tenant_name"),
    volume_title: z.string().trim().default(""),
  })
  .refine(
    (data) =>
      [
        data.episode_title !== "",
        data.volume_title !== "",
        data.series_bundle_episode_count > 0,
      ].filter(Boolean).length === 1,
    {
      error:
        "exactly one of episode_title, volume_title, and series_bundle_episode_count is required",
    }
  );

export type PurchaseReceiptData = z.output<typeof purchaseReceiptDataSchema>;

export interface PurchaseReceiptEmailProps {
  data: PurchaseReceiptData;
  locale: Locale;
  messages: Messages;
  timeZone: string;
}

/** What the receipt names as bought: the episode, the volume, or the series. */
const purchasedTitle = (data: PurchaseReceiptData): string => {
  if (data.episode_title !== "") {
    return data.episode_title;
  }
  return data.volume_title === "" ? data.series_title : data.volume_title;
};

export const purchaseReceiptPreview = (
  data: PurchaseReceiptData,
  messages: Messages
): string =>
  emailMessage(messages, "email.purchase_receipt.preview", {
    title: purchasedTitle(data),
  });

const PurchasedItem = ({
  data,
  messages,
}: {
  data: PurchaseReceiptData;
  messages: Messages;
}) => {
  if (data.episode_title !== "") {
    return emailMessage(messages, "email.purchase_receipt.episode", {
      episode_title: data.episode_title,
    });
  }
  if (data.volume_title !== "") {
    return emailMessage(messages, "email.purchase_receipt.volume", {
      volume_title: data.volume_title,
    });
  }
  return emailMessage(messages, "email.purchase_receipt.series_bundle", {
    count: data.series_bundle_episode_count,
  });
};

/**
 * The receipt a reader is sent for a purchase. The price names its currency by
 * code beside the symbol, because a symbol such as `$` stands for more than
 * one currency, and a purchase with no reading period has no line saying when
 * it ends. A purchase paid in the provider's test mode, which the documented
 * setup asks an operator to make, says it charged nothing, so its price paid is
 * not read as money taken.
 */
export const PurchaseReceiptEmail = ({
  data,
  locale,
  messages,
  timeZone,
}: PurchaseReceiptEmailProps) => (
  <EmailLayout
    brand={data.tenant_name}
    locale={locale}
    messages={messages}
    preview={purchaseReceiptPreview(data, messages)}
  >
    <EmailHeading>
      {emailMessage(messages, "email.purchase_receipt.heading")}
    </EmailHeading>
    <EmailIntro>
      {emailMessage(messages, "email.purchase_receipt.intro", {
        tenant_name: data.tenant_name,
      })}
    </EmailIntro>
    {data.is_test ? (
      <EmailMeta>
        {emailMessage(messages, "email.purchase_receipt.test_notice")}
      </EmailMeta>
    ) : null}
    <EmailDetail>
      {emailMessage(messages, "email.purchase_receipt.series", {
        series_title: data.series_title,
      })}
    </EmailDetail>
    <EmailDetail>
      <PurchasedItem data={data} messages={messages} />
    </EmailDetail>
    <EmailDetail>
      {emailMessage(messages, "email.purchase_receipt.amount", {
        amount: formatPrice(data.amount, { currency: data.currency, locale }),
        currency: data.currency,
      })}
    </EmailDetail>
    <EmailDetail>
      {emailMessage(messages, "email.purchase_receipt.purchased_at", {
        purchased_at: formatDateTime(data.purchased_at, { locale, timeZone }),
      })}
    </EmailDetail>
    {data.expires_at === "" ? null : (
      <EmailDetail>
        {emailMessage(messages, "email.purchase_receipt.expires_at", {
          expires_at: formatDateTime(data.expires_at, { locale, timeZone }),
        })}
      </EmailDetail>
    )}
    <EmailButton href={data.library_url}>
      {emailMessage(messages, "email.purchase_receipt.action")}
    </EmailButton>
    <EmailFallbackLink href={data.library_url}>
      {emailMessage(messages, "email.purchase_receipt.fallback_link")}
    </EmailFallbackLink>
  </EmailLayout>
);
