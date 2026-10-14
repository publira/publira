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
import { displayNameField, httpUrlField, instantField } from "./fields";

/**
 * A title from the catalogue. The console stores titles with no length limit,
 * and they reach the mail's body rather than a header, so nothing here refuses
 * one the server already stored: a receipt that cannot render is never sent.
 */
const catalogTitleField = (name: string) =>
  z
    .string()
    .trim()
    .min(1, { error: `${name} is required` });

export const purchaseReceiptDataSchema = z.object({
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
  episode_title: catalogTitleField("episode_title"),
  /** Empty for a purchase with no reading period. */
  expires_at: z.union([z.literal(""), instantField("expires_at")]),
  /** Whether the purchase was paid in the payment provider's test mode. */
  is_test: z.boolean({ error: "is_test must be a boolean" }),
  library_url: httpUrlField("library_url"),
  purchased_at: instantField("purchased_at"),
  series_title: catalogTitleField("series_title"),
  tenant_name: displayNameField("tenant_name"),
});

export type PurchaseReceiptData = z.output<typeof purchaseReceiptDataSchema>;

export interface PurchaseReceiptEmailProps {
  data: PurchaseReceiptData;
  locale: Locale;
  messages: Messages;
  timeZone: string;
}

export const purchaseReceiptPreview = (
  data: PurchaseReceiptData,
  messages: Messages
): string =>
  emailMessage(messages, "email.purchase_receipt.preview", {
    episode_title: data.episode_title,
  });

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
      {emailMessage(messages, "email.purchase_receipt.episode", {
        episode_title: data.episode_title,
      })}
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
