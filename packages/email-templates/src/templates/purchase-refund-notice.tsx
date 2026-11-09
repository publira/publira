import type { Locale } from "@publira/i18n";
import { formatPrice, listSupportedCurrencies } from "@publira/utils";
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
import { displayNameField, httpUrlField } from "./fields";

const minorUnitField = (name: string) =>
  z
    .number()
    .int({ error: `${name} must be an integer in the minor unit` })
    .min(0, { error: `${name} must not be negative` });

export const purchaseRefundNoticeDataSchema: z.ZodObject<
  {
    amount: z.ZodNumber;
    closed: z.ZodBoolean;
    coin_name: z.ZodDefault<z.ZodString>;
    coin_pack_bonus_coins: z.ZodDefault<z.ZodNumber>;
    coin_pack_coins: z.ZodDefault<z.ZodNumber>;
    currency: z.ZodString;
    episode_title: z.ZodDefault<z.ZodString>;
    is_test: z.ZodBoolean;
    is_tip: z.ZodBoolean;
    library_url: z.ZodString;
    price: z.ZodNumber;
    refunded_total: z.ZodNumber;
    series_bundle_episode_count: z.ZodDefault<z.ZodNumber>;
    series_title: z.ZodDefault<z.ZodString>;
    tenant_name: z.ZodString;
    volume_title: z.ZodDefault<z.ZodString>;
  },
  z.core.$strip
> = z
  .object({
    /** What this refund returned, an integer in the minor unit of `currency`. */
    amount: minorUnitField("amount").refine((value) => value > 0, {
      error: "amount must be more than nothing",
    }),
    /** Whether the refunds have reached the price, which closes the purchase. */
    closed: z.boolean({ error: "closed must be a boolean" }),
    /**
     * The pack of coins bought: its coins and bonus coins and the tenant's
     * word for them. 0 and empty on any other purchase.
     */
    coin_name: z.string().trim().default(""),
    coin_pack_bonus_coins: z
      .number()
      .int({ error: "coin_pack_bonus_coins must be an integer" })
      .min(0, { error: "coin_pack_bonus_coins must not be negative" })
      .default(0),
    coin_pack_coins: z
      .number()
      .int({ error: "coin_pack_coins must be an integer" })
      .min(0, { error: "coin_pack_coins must not be negative" })
      .default(0),
    currency: z
      .string()
      .trim()
      .refine((value) => listSupportedCurrencies().includes(value), {
        error: "currency must be an ISO 4217 code",
      }),
    /**
     * What was bought, as the receipt names it: the title of the episode or
     * the volume, the number of episodes the rest of the series held, or the
     * coins of the pack, the others empty, 0, or left out.
     */
    episode_title: z.string().trim().default(""),
    /** Whether the purchase was paid in the payment provider's test mode. */
    is_test: z.boolean({ error: "is_test must be a boolean" }),
    /** Whether the purchase is a tip to the Authors of `episode_title`. */
    is_tip: z.boolean({ error: "is_tip must be a boolean" }),
    library_url: httpUrlField("library_url"),
    /** The price paid, in the minor unit of `currency`. */
    price: minorUnitField("price"),
    /** What every refund of the purchase adds up to, this one included. */
    refunded_total: minorUnitField("refunded_total"),
    series_bundle_episode_count: z
      .number()
      .int({ error: "series_bundle_episode_count must be an integer" })
      .min(0, { error: "series_bundle_episode_count must not be negative" })
      .default(0),
    /** Empty on a purchase of a pack, which is of no series. */
    series_title: z.string().trim().default(""),
    tenant_name: displayNameField("tenant_name"),
    volume_title: z.string().trim().default(""),
  })
  .refine(
    (data) =>
      [
        data.episode_title !== "",
        data.volume_title !== "",
        data.series_bundle_episode_count > 0,
        data.coin_pack_coins > 0,
      ].filter(Boolean).length === 1,
    {
      error:
        "exactly one of episode_title, volume_title, series_bundle_episode_count, and coin_pack_coins is required",
    }
  )
  .refine((data) => data.coin_pack_coins > 0 === (data.series_title === ""), {
    error: "series_title is required on every purchase but a pack's",
  })
  .refine((data) => data.coin_pack_coins > 0 || data.coin_name === "", {
    error: "coin_name names the coins of a pack, and nothing else",
  })
  .refine((data) => !data.is_tip || data.episode_title !== "", {
    error: "a tip names the episode whose Authors it went to",
  })
  .refine((data) => data.refunded_total >= data.amount, {
    error: "refunded_total must include amount",
  });

export type PurchaseRefundNoticeData = z.output<
  typeof purchaseRefundNoticeDataSchema
>;

export interface PurchaseRefundNoticeEmailProps {
  data: PurchaseRefundNoticeData;
  locale: Locale;
  messages: Messages;
}

/**
 * What the mail names as refunded: the episode, the volume, the series, or the
 * tenant's coins.
 */
const refundedTitle = (data: PurchaseRefundNoticeData): string => {
  if (data.coin_pack_coins > 0) {
    return data.coin_name;
  }

  if (data.episode_title !== "") {
    return data.episode_title;
  }

  return data.volume_title === "" ? data.series_title : data.volume_title;
};

export const purchaseRefundNoticePreview = (
  data: PurchaseRefundNoticeData,
  messages: Messages
): string =>
  emailMessage(messages, "email.purchase_refund_notice.preview", {
    title: refundedTitle(data),
  });

const RefundedItem = ({
  data,
  messages,
}: {
  data: PurchaseRefundNoticeData;
  messages: Messages;
}) => {
  if (data.is_tip) {
    return emailMessage(messages, "email.purchase_refund_notice.tip", {
      episode_title: data.episode_title,
    });
  }

  if (data.coin_pack_coins > 0) {
    return emailMessage(messages, "email.purchase_refund_notice.coin_pack", {
      bonus: data.coin_pack_bonus_coins,
      coin_name: data.coin_name,
      count: data.coin_pack_coins + data.coin_pack_bonus_coins,
    });
  }

  if (data.episode_title !== "") {
    return emailMessage(messages, "email.purchase_refund_notice.episode", {
      episode_title: data.episode_title,
    });
  }

  if (data.volume_title !== "") {
    return emailMessage(messages, "email.purchase_refund_notice.volume", {
      volume_title: data.volume_title,
    });
  }

  return emailMessage(messages, "email.purchase_refund_notice.series_bundle", {
    count: data.series_bundle_episode_count,
  });
};

/**
 * What the refund leaves open: a tip opened nothing; a pack keeps its coins
 * unless it is refunded in full; any other purchase keeps opening what it
 * bought unless it is refunded in full.
 */
const RefundOutcome = ({
  data,
  messages,
}: {
  data: PurchaseRefundNoticeData;
  messages: Messages;
}) => {
  if (data.is_tip) {
    return null;
  }

  if (data.coin_pack_coins > 0) {
    return (
      <EmailBody>
        {emailMessage(
          messages,
          data.closed
            ? "email.purchase_refund_notice.coins_closed"
            : "email.purchase_refund_notice.coins_open",
          { coin_name: data.coin_name }
        )}
      </EmailBody>
    );
  }

  return (
    <EmailBody>
      {emailMessage(
        messages,
        data.closed
          ? "email.purchase_refund_notice.closed"
          : "email.purchase_refund_notice.open"
      )}
    </EmailBody>
  );
};

/**
 * The mail that tells a reader a refund was made on one of their purchases. It
 * names what was bought as the receipt does and what this refund returned,
 * with its currency by code beside the symbol. Once an earlier refund makes the
 * total differ from this one, it states the total against the price paid. It
 * then says what the refund leaves open, and a purchase made in the provider's
 * test mode says no money moved, as its receipt did.
 */
export const PurchaseRefundNoticeEmail = ({
  data,
  locale,
  messages,
}: PurchaseRefundNoticeEmailProps): JSX.Element => (
  <EmailLayout
    brand={data.tenant_name}
    locale={locale}
    messages={messages}
    preview={purchaseRefundNoticePreview(data, messages)}
  >
    <EmailHeading>
      {emailMessage(messages, "email.purchase_refund_notice.heading")}
    </EmailHeading>
    <EmailIntro>
      {emailMessage(messages, "email.purchase_refund_notice.intro", {
        tenant_name: data.tenant_name,
      })}
    </EmailIntro>
    {data.is_test ? (
      <EmailMeta>
        {emailMessage(messages, "email.purchase_refund_notice.test_notice")}
      </EmailMeta>
    ) : null}
    {data.series_title === "" ? null : (
      <EmailDetail>
        {emailMessage(messages, "email.purchase_refund_notice.series", {
          series_title: data.series_title,
        })}
      </EmailDetail>
    )}
    <EmailDetail>
      <RefundedItem data={data} messages={messages} />
    </EmailDetail>
    <EmailDetail>
      {emailMessage(messages, "email.purchase_refund_notice.amount", {
        amount: formatPrice(data.amount, { currency: data.currency, locale }),
        currency: data.currency,
      })}
    </EmailDetail>
    {data.refunded_total > data.amount ? (
      <EmailDetail>
        {emailMessage(messages, "email.purchase_refund_notice.total", {
          price: formatPrice(data.price, { currency: data.currency, locale }),
          total: formatPrice(data.refunded_total, {
            currency: data.currency,
            locale,
          }),
        })}
      </EmailDetail>
    ) : null}
    <RefundOutcome data={data} messages={messages} />
    <EmailButton href={data.library_url}>
      {emailMessage(messages, "email.purchase_refund_notice.action")}
    </EmailButton>
    <EmailFallbackLink href={data.library_url}>
      {emailMessage(messages, "email.purchase_refund_notice.fallback_link")}
    </EmailFallbackLink>
  </EmailLayout>
);
