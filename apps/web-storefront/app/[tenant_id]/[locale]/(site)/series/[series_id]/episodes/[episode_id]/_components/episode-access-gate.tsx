import type { Locale } from "@publira/i18n";
import { Button, LinkButton } from "@publira/ui-components/button";
import { QrCode, toQrCodePath } from "@publira/ui-components/qr-code";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import {
  formatDateTimeWithWeekday,
  formatDuration,
  formatPrice,
} from "@publira/utils";
import Image from "next/image";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { CampaignPrice } from "#components/campaign-price";
import { CoinDisclosures } from "#components/coin-disclosures";
import { CoinPackCheckoutForm } from "#components/coin-pack-checkout-form";
import { LocaleField } from "#components/locale-field";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import * as PaymentProviderChoice from "#components/payment-provider-choice";
import * as PromotionCode from "#components/promotion-code";
import {
  episodeSaleDestination,
  toTenantSaleChannels,
} from "#lib/app-payments";
import type { TenantAppPayments } from "#lib/app-payments";
import type {
  EpisodeCampaign,
  EpisodeNeighborItem,
  EpisodePurchaseSurface,
} from "#lib/catalog";
import { coinPackTotal } from "#lib/coins";
import type { PaymentProviderOption } from "#lib/payment-providers";
import { episodeSaleKinds } from "#lib/promotion-code";
import type { EpisodeSaleKind, PromotionCodeState } from "#lib/promotion-code";
import type { TenantImageVariant } from "#lib/tenant";

import { episodeLoginHref } from "../_lib/access-gate";
import {
  applyEpisodePromotionCodeAction,
  openWithWaitFreeTicketAction,
  payEpisodeWithCoinsAction,
  startEpisodeCheckoutAction,
} from "../_lib/actions";
import { coinsCarryShu, offersCoinPayment } from "../_lib/coin-offer";
import type { CoinOffer } from "../_lib/coin-offer";
import { episodePath } from "../_lib/episode-path";
import type { WaitFreeOffer } from "../_lib/wait-free-offer";
import { WaitFreeCountdown } from "./wait-free-countdown";

/**
 * The store listings the gate links to: only those whose app sells, since a
 * listing whose app offers no purchase would send the reader on to nothing.
 */
const sellingStoreUrls = (
  appPayments: TenantAppPayments,
  {
    appStoreUrl,
    googlePlayUrl,
  }: { appStoreUrl?: string; googlePlayUrl?: string }
) => ({
  sellingAppStoreUrl: appPayments.appStore ? appStoreUrl : undefined,
  sellingGooglePlayUrl: appPayments.googlePlay ? googlePlayUrl : undefined,
});

/** The height a store badge is drawn at, which Apple sets as its minimum. */
const STORE_BADGE_HEIGHT_PX = 40;

/**
 * One store's link: the badge the tenant uploaded for it, or a button with the
 * store's name where it uploaded none. The badge is drawn at its master's own
 * aspect ratio, and the store's name stays the link's accessible name, since
 * the words on a badge are a picture.
 */
const StoreLink = ({
  badge,
  children,
  href,
  variant,
}: {
  badge?: TenantImageVariant;
  /** The store's name. */
  children: ReactNode;
  href: string;
  variant: "outline" | "secondary";
}) =>
  badge ? (
    <a
      className="inline-flex rounded-control focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
      href={href}
    >
      <Image
        alt=""
        className="h-10 w-auto"
        height={badge.height}
        sizes={`${Math.ceil((STORE_BADGE_HEIGHT_PX * badge.width) / badge.height)}px`}
        src={badge.url}
        width={badge.width}
      />
      <span className="sr-only">{children}</span>
    </a>
  ) : (
    <LinkButton href={href} size="lg" variant={variant}>
      {children}
    </LinkButton>
  );

/**
 * The stores the tenant's app is listed in: each one's link, and above it a
 * code a phone can scan from a wider screen. A phone gets the links alone,
 * because it cannot scan a code on its own screen.
 */
const AppStoreLinks = ({
  appStoreBadge,
  appStoreUrl,
  googlePlayBadge,
  googlePlayUrl,
  variant,
}: {
  appStoreBadge?: TenantImageVariant;
  appStoreUrl?: string;
  googlePlayBadge?: TenantImageVariant;
  googlePlayUrl?: string;
  variant: "outline" | "secondary";
}) => (
  <div className="flex flex-wrap items-end justify-center gap-6">
    {appStoreUrl ? (
      <div className="grid justify-items-center gap-3">
        <QrCode
          {...toQrCodePath(appStoreUrl)}
          className="hidden size-32 md:block"
        />
        <StoreLink badge={appStoreBadge} href={appStoreUrl} variant={variant}>
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="storefront.episode.gate.app_store" />
          </Suspense>
        </StoreLink>
      </div>
    ) : null}
    {googlePlayUrl ? (
      <div className="grid justify-items-center gap-3">
        <QrCode
          {...toQrCodePath(googlePlayUrl)}
          className="hidden size-32 md:block"
        />
        <StoreLink
          badge={googlePlayBadge}
          href={googlePlayUrl}
          variant={variant}
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="storefront.episode.gate.google_play" />
          </Suspense>
        </StoreLink>
      </div>
    ) : null}
  </div>
);

/**
 * Why the body is closed, in the six states the gate can be in. Each branch
 * writes its own key out: a key chosen somewhere else and handed over as a
 * value is one that nothing reading this file can account for.
 */
const ClosedBecause = ({
  payable,
  signedIn,
  soldInApp,
}: {
  payable: boolean;
  signedIn: boolean;
  soldInApp: boolean;
}) => {
  if (signedIn && soldInApp) {
    return (
      <Message message="storefront.episode.gate.signed_in_app_only_description" />
    );
  }

  if (signedIn && payable) {
    return (
      <Message message="storefront.episode.gate.signed_in_payable_description" />
    );
  }

  if (signedIn) {
    return (
      <Message message="storefront.episode.gate.signed_in_unpayable_description" />
    );
  }

  if (soldInApp) {
    return (
      <Message message="storefront.episode.gate.guest_app_only_description" />
    );
  }

  if (payable) {
    return (
      <Message message="storefront.episode.gate.guest_payable_description" />
    );
  }

  return (
    <Message message="storefront.episode.gate.guest_unpayable_description" />
  );
};

/**
 * The reader's ticket is ready: what it does, and the control that spends it.
 */
const WaitFreeTicketForm = ({
  accessHours,
  episodeId,
  episodePublicId,
  locale,
  seriesPublicId,
  tenantId,
  variant,
}: {
  accessHours: number;
  episodeId: string;
  episodePublicId: string;
  locale: Locale;
  seriesPublicId: string;
  tenantId: string;
  variant: "outline" | "secondary";
}) => (
  <div className="grid justify-items-center gap-3">
    <p className="text-sm">
      <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
        <Message
          message="storefront.episode.gate.wait_free_ready"
          values={{
            access: formatDuration({ hours: accessHours }, { locale }),
          }}
        />
      </Suspense>
    </p>
    <form action={openWithWaitFreeTicketAction}>
      <LocaleField />
      <input name="tenantId" type="hidden" value={tenantId} />
      <input name="seriesPublicId" type="hidden" value={seriesPublicId} />
      <input name="episodePublicId" type="hidden" value={episodePublicId} />
      <input name="episodeId" type="hidden" value={episodeId} />
      <Button size="lg" type="submit" variant={variant}>
        <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
          <Message message="storefront.episode.gate.wait_free_use" />
        </Suspense>
      </Button>
    </form>
  </div>
);

/**
 * One sale the gate offers: a form that starts the checkout for `kind`.
 * Every sale posts the same episode, so the two a rented episode offers differ
 * in the kind they send and in what their button says.
 */
const CheckoutForm = ({
  children,
  currency,
  episodeId,
  episodePublicId,
  kind,
  locale,
  rentalPeriodHours,
  seriesPublicId,
  taxIncluded,
  tenantId,
  variant,
}: {
  children: ReactNode;
  currency: string | null;
  episodeId: string;
  episodePublicId: string;
  kind: EpisodeSaleKind;
  locale: Locale;
  rentalPeriodHours: number;
  seriesPublicId: string;
  taxIncluded: boolean;
  tenantId: string;
  variant: "outline" | "secondary";
}) => (
  <form action={startEpisodeCheckoutAction}>
    <LocaleField />
    <input name="tenantId" type="hidden" value={tenantId} />
    <input name="seriesPublicId" type="hidden" value={seriesPublicId} />
    <input name="episodePublicId" type="hidden" value={episodePublicId} />
    <input name="episodeId" type="hidden" value={episodeId} />
    <input name="kind" type="hidden" value={kind} />
    <PaymentProviderChoice.Input />
    <PromotionCode.CheckoutSubmit
      currency={currency}
      kind={kind}
      locale={locale}
      rentalPeriodHours={rentalPeriodHours}
      sale={kind}
      size="lg"
      taxIncluded={taxIncluded}
      variant={variant}
    >
      {children}
    </PromotionCode.CheckoutSubmit>
  </form>
);

/**
 * What the episode is sold as. A rented one is offered both ways, each button
 * naming what it costs and the rental how long it lasts, because the choice
 * is between those two numbers. An episode that is not rented keeps the one
 * button it always had, which needs no price beside it.
 *
 * The permanent copy keeps the Shu, as it does on an episode with one sale;
 * the rental is the alternative to it, and both stay outlined behind a ready
 * ticket or coins that pay for the episode. Neither is quoted without the
 * tenant's currency, which leaves the permanent copy alone, the way an episode
 * that is not rented is sold.
 *
 * Under a campaign the permanent copy's button names the campaign price
 * whether or not the episode is rented: the gate quotes it above the buttons,
 * and a button that said only "Buy" would leave the reader to guess which of
 * the two prices it charges. A button that names a price says it includes tax
 * while the tenant states a rate.
 *
 * A promotion code the gate's field applied rewrites the price of each button
 * whose sale it applies to (`PromotionCode.CheckoutSubmit`).
 */
const CheckoutActions = ({
  campaign,
  currency,
  episodeId,
  episodePublicId,
  locale,
  price,
  rentalPeriodHours,
  rentalPrice,
  seriesPublicId,
  shuElsewhere,
  taxIncluded,
  tenantId,
}: {
  campaign?: EpisodeCampaign;
  currency: string | null;
  episodeId: string;
  episodePublicId: string;
  locale: Locale;
  price: number;
  rentalPeriodHours: number;
  rentalPrice: number;
  seriesPublicId: string;
  /** Whether a ready ticket or the reader's coins carry the Shu instead. */
  shuElsewhere: boolean;
  /** Whether the tenant states a tax rate, which every price includes. */
  taxIncluded: boolean;
  tenantId: string;
}) => {
  const formProps = {
    currency,
    episodeId,
    episodePublicId,
    locale,
    rentalPeriodHours,
    seriesPublicId,
    taxIncluded,
    tenantId,
  };

  const purchaseVariant = shuElsewhere ? "outline" : "secondary";

  const rented = episodeSaleKinds({ rentalPeriodHours, rentalPrice }).includes(
    "rental"
  );

  if (!currency || !(rented || campaign)) {
    return (
      <CheckoutForm {...formProps} kind="purchase" variant={purchaseVariant}>
        <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
          <Message message="storefront.episode.gate.purchase" />
        </Suspense>
      </CheckoutForm>
    );
  }

  const purchaseValues = {
    price: formatPrice(campaign?.price ?? price, { currency, locale }),
  };

  const rentalValues = {
    period: formatDuration({ hours: rentalPeriodHours }, { locale }),
    price: formatPrice(rentalPrice, { currency, locale }),
  };

  return (
    <>
      <CheckoutForm {...formProps} kind="purchase" variant={purchaseVariant}>
        <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
          {taxIncluded ? (
            <Message
              message="storefront.episode.gate.purchase_for_tax_included"
              values={purchaseValues}
            />
          ) : (
            <Message
              message="storefront.episode.gate.purchase_for"
              values={purchaseValues}
            />
          )}
        </Suspense>
      </CheckoutForm>
      {rented ? (
        <CheckoutForm {...formProps} kind="rental" variant="outline">
          <Suspense fallback={<SkeletonLine className="h-4 w-44" />}>
            {taxIncluded ? (
              <Message
                message="storefront.episode.gate.rent_for_tax_included"
                values={rentalValues}
              />
            ) : (
              <Message
                message="storefront.episode.gate.rent_for"
                values={rentalValues}
              />
            )}
          </Suspense>
        </CheckoutForm>
      ) : null}
    </>
  );
};

/**
 * The providers the gate lets the reader choose between: those of the site's
 * checkout wherever the gate starts one, which is the episode's own for a
 * signed-in reader on an episode the site sells, and the pack that makes up
 * the coins they are short of. None elsewhere, so a guest is asked nothing.
 */
const gatePaymentProviders = ({
  coinOffer,
  payable,
  paymentProviders,
  signedIn,
}: {
  coinOffer?: CoinOffer;
  payable: boolean;
  paymentProviders: readonly PaymentProviderOption[];
  signedIn: boolean;
}): readonly PaymentProviderOption[] => {
  const sellsPack = coinOffer?.kind === "offer" && coinOffer.pack !== undefined;

  return signedIn && (payable || sellsPack) ? paymentProviders : [];
};

/**
 * The promotion code the gate offers its field with: only beside the checkout
 * buttons the field rewrites, which a signed-in reader is offered on an
 * episode the site sells, and only in a currency their prices can be written
 * in.
 */
const offeredPromotionCode = ({
  currency,
  payable,
  promotionCode,
  signedIn,
}: {
  currency: string | null;
  payable: boolean;
  promotionCode?: PromotionCodeState<EpisodeSaleKind>;
  signedIn: boolean;
}): PromotionCodeState<EpisodeSaleKind> | undefined =>
  signedIn && payable && currency !== null ? promotionCode : undefined;

/**
 * The gate inside the promotion code's state, where it offers the field; the
 * field and the buttons render as they would without one elsewhere.
 *
 * Keyed on the code the URL carried: a checkout refused for its code comes
 * back to the gate with it, and the field starts over from that quote.
 */
const PromotionCodeScope = ({
  children,
  offer,
}: {
  children: ReactNode;
  offer?: PromotionCodeState<EpisodeSaleKind>;
}) =>
  offer ? (
    <PromotionCode.Root
      action={applyEpisodePromotionCodeAction}
      initialState={offer}
      key={offer.kind === "none" ? "" : offer.code}
    >
      {children}
    </PromotionCode.Root>
  ) : (
    children
  );

/**
 * One payment the gate offers for coins: a form that spends `coins` on the
 * sale of `kind`. The price is sent with it, so the reader is never charged
 * other than what the button said, and the key names this one payment, so a
 * second tap spends nothing more.
 */
const CoinPaymentForm = ({
  children,
  coins,
  episodeId,
  episodePublicId,
  idempotencyKey,
  kind,
  seriesPublicId,
  tenantId,
  variant,
}: {
  children: ReactNode;
  coins: number;
  episodeId: string;
  episodePublicId: string;
  idempotencyKey: string;
  kind: "purchase" | "rental";
  seriesPublicId: string;
  tenantId: string;
  variant: "outline" | "secondary";
}) => (
  <form action={payEpisodeWithCoinsAction}>
    <LocaleField />
    <input name="tenantId" type="hidden" value={tenantId} />
    <input name="seriesPublicId" type="hidden" value={seriesPublicId} />
    <input name="episodePublicId" type="hidden" value={episodePublicId} />
    <input name="episodeId" type="hidden" value={episodeId} />
    <input name="kind" type="hidden" value={kind} />
    <input name="coins" type="hidden" value={coins} />
    <input name="idempotencyKey" type="hidden" value={idempotencyKey} />
    <Button size="lg" type="submit" variant={variant}>
      {children}
    </Button>
  </form>
);

/**
 * What the gate offers for the tenant's coins: the reader's balance, a
 * payment for each sale it covers, and, when it falls short of the permanent
 * copy, the smallest pack that makes up the difference, sold with its expiry
 * and the tenant's disclosures beside it. A site with no pack large enough
 * sends the reader to every pack it sells instead.
 *
 * Every string names the coins in the tenant's own word for them.
 */
const CoinSection = ({
  episodeId,
  episodePublicId,
  locale,
  offer,
  rentalPeriodHours,
  seriesPublicId,
  shuTaken,
  tenantId,
}: {
  episodeId: string;
  episodePublicId: string;
  locale: Locale;
  /** Absent where the gate offers nothing for coins. */
  offer: CoinOffer | undefined;
  rentalPeriodHours: number;
  seriesPublicId: string;
  /** Whether a ready ticket carries the Shu. */
  shuTaken: boolean;
  tenantId: string;
}) => {
  if (!offer) {
    return null;
  }

  if (offer.kind === "failed") {
    return (
      <output className="block text-sm text-muted-foreground">
        {offer.message}
      </output>
    );
  }

  const formProps = {
    episodeId,
    episodePublicId,
    idempotencyKey: offer.idempotencyKey,
    seriesPublicId,
    tenantId,
  };

  const { coinName } = offer;
  const payVariant = shuTaken ? "outline" : "secondary";
  const rented = offer.rentalPrice > 0 && rentalPeriodHours > 0;
  const rentable = rented && offer.balance >= offer.rentalPrice;
  const { pack } = offer;

  return (
    <div className="grid justify-items-center gap-3">
      <p className="text-sm tabular-nums">
        <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
          {offer.needed > 0n ? (
            <Message
              message="storefront.episode.gate.coin_short"
              values={{
                balance: offer.balance,
                coin_name: coinName,
                count: offer.needed,
                price: offer.price,
              }}
            />
          ) : (
            <Message
              message="storefront.episode.gate.coin_balance"
              values={{ coin_name: coinName, count: offer.balance }}
            />
          )}
        </Suspense>
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        {offer.needed === 0n ? (
          <CoinPaymentForm
            {...formProps}
            coins={offer.price}
            kind="purchase"
            variant={payVariant}
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
              <Message
                message="storefront.episode.gate.coin_pay"
                values={{ coin_name: coinName, count: offer.price }}
              />
            </Suspense>
          </CoinPaymentForm>
        ) : null}
        {rentable ? (
          <CoinPaymentForm
            {...formProps}
            coins={offer.rentalPrice}
            kind="rental"
            variant={offer.needed === 0n ? "outline" : payVariant}
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-44" />}>
              <Message
                message="storefront.episode.gate.coin_rent"
                values={{
                  coin_name: coinName,
                  count: offer.rentalPrice,
                  period: formatDuration(
                    { hours: rentalPeriodHours },
                    { locale }
                  ),
                }}
              />
            </Suspense>
          </CoinPaymentForm>
        ) : null}
        {pack ? (
          <CoinPackCheckoutForm
            coinPackId={pack.id}
            returnEpisode={{
              id: episodeId,
              publicId: episodePublicId,
              seriesPublicId,
            }}
            size="lg"
            tenantId={tenantId}
            variant="outline"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
              <Message
                message="storefront.episode.gate.coin_pack_buy"
                values={{
                  bonus: pack.bonusCoins,
                  coin_name: coinName,
                  count: coinPackTotal(pack),
                  price: formatPrice(pack.price, {
                    currency: pack.currency,
                    locale,
                  }),
                }}
              />
            </Suspense>
          </CoinPackCheckoutForm>
        ) : null}
        {offer.needed > 0n && !pack && offer.packsOnSale ? (
          <LinkButton
            render={<LocaleLink href="/my/coins" />}
            size="lg"
            variant="outline"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
              <Message
                message="storefront.episode.gate.coin_packs"
                values={{ coin_name: coinName }}
              />
            </Suspense>
          </LinkButton>
        ) : null}
      </div>
      {pack ? (
        <>
          <p className="text-sm text-muted-foreground">
            <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
              <Message
                message="storefront.coins.pack_expiry"
                values={{ coin_name: coinName, days: offer.expiryDays }}
              />
            </Suspense>
          </p>
          <CoinDisclosures disclosures={offer.disclosures} />
        </>
      ) : null}
    </div>
  );
};

/**
 * What the gate says about wait-for-free, in the five states the offer can be
 * in, each with its own key written out for the reason the gate gives.
 *
 * A ticket that is ready is the Shu, which the gate takes from the purchase.
 * One still recharging becomes ready while the reader looks at the page, after
 * the gate has given the Shu to whatever else was on screen, so the control it
 * then offers is outlined; the next load of the page makes it the Shu.
 */
const WaitFreeSection = ({
  episodeId,
  episodePublicId,
  locale,
  offer,
  seriesPublicId,
  tenantId,
  timeZone,
}: {
  episodeId: string;
  episodePublicId: string;
  locale: Locale;
  offer: WaitFreeOffer;
  seriesPublicId: string;
  tenantId: string;
  timeZone: string;
}) => {
  const ticketProps = {
    episodeId,
    episodePublicId,
    locale,
    seriesPublicId,
    tenantId,
  };

  switch (offer.kind) {
    case "ready": {
      return (
        <WaitFreeTicketForm
          {...ticketProps}
          accessHours={offer.accessHours}
          variant="secondary"
        />
      );
    }

    case "recharging": {
      return (
        <WaitFreeCountdown
          absolute={formatDateTimeWithWeekday(offer.nextAvailableAt, {
            fallback: "",
            locale,
            timeZone,
          })}
          nextAvailableAt={offer.nextAvailableAt}
        >
          <WaitFreeTicketForm
            {...ticketProps}
            accessHours={offer.accessHours}
            variant="outline"
          />
        </WaitFreeCountdown>
      );
    }

    case "excluded": {
      return (
        <p className="text-sm text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="storefront.episode.gate.wait_free_excluded" />
          </Suspense>
        </p>
      );
    }

    case "guest": {
      return (
        <p className="text-sm">
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="storefront.episode.gate.wait_free_guest" />
          </Suspense>
        </p>
      );
    }

    default: {
      return (
        <output className="block text-sm text-muted-foreground">
          {offer.message}
        </output>
      );
    }
  }
};

/**
 * What the gate opens with: that the preview has ended, where the reader has
 * just turned its pages, and otherwise why the episode is closed to them.
 */
const GateTitle = ({
  previewEnded,
  signedIn,
}: {
  previewEnded: boolean;
  signedIn: boolean;
}) => {
  if (previewEnded) {
    return <Message message="storefront.episode.gate.preview_ended_title" />;
  }

  return signedIn ? (
    <Message message="storefront.episode.gate.signed_in_title" />
  ) : (
    <Message message="storefront.episode.gate.guest_title" />
  );
};

/**
 * The card over the preview when the reader may not open the pages: why the
 * body is closed, the one thing that opens it, and the nearest later episode
 * they could read instead.
 *
 * That action is the screen's single Shu. On an episode a reader can read, the
 * Shu is the mark on the next episode below the pages; here the next thing to
 * do is to get into this one, so the mark moves to the action that does it and
 * the row below carries none. The free episode is a way around this one rather
 * than into it, so it is a link under the actions and not a third button.
 *
 * On a series that offers wait-for-free, a ready ticket is the way in that
 * costs the reader nothing, so it takes the Shu from the purchase. A ticket
 * still recharging counts down to the moment it is ready and then offers
 * itself, without taking the Shu from an action already on screen.
 *
 * A plan the tenant sells that opens the episode is offered beside the
 * purchase, as a link to the plan page rather than a checkout of its own: the
 * reader chooses between plans there, sees what each one opens, and is told
 * if they already hold one.
 *
 * A reader whose coins pay for the episode is offered that payment, which
 * takes the Shu from the purchase: it opens the episode without leaving the
 * page. One whose coins fall short is offered the pack that covers the
 * difference, beside the purchase rather than in place of it.
 *
 * An episode under a campaign that the site sells says so over the actions,
 * to a guest as to a reader signed in: the campaign is a reason to sign in and
 * buy now, and its end is when that reason runs out. One sold in the app is
 * not quoted, because the store sets the price there.
 *
 * Where the reader has just turned the episode's preview pages, the gate is the
 * page after them, and its heading says the preview has ended rather than that
 * the episode is closed: the reader already knows it is paid, and what they
 * are looking at is where the free part stops.
 */
export const EpisodeAccessGate = ({
  acceptsPayments,
  appPayments,
  appStoreBadge,
  appStoreUrl,
  campaign,
  coinOffer,
  currency,
  episodeId,
  episodePublicId,
  googlePlayBadge,
  googlePlayUrl,
  locale,
  nextFreeEpisode,
  paymentProviders,
  previewEnded = false,
  price,
  promotionCode,
  purchaseSurface,
  rentalPeriodHours,
  rentalPrice,
  seriesPublicId,
  signedIn,
  subscribable,
  taxIncluded,
  tenantId,
  timeZone,
  waitFree,
}: {
  acceptsPayments: boolean;
  appPayments: TenantAppPayments;
  /**
   * The badge the tenant uploaded for each store's link; absent where it
   * uploaded none, and the link reads as the store's name.
   */
  appStoreBadge?: TenantImageVariant;
  /** Where the tenant's app is listed; absent where it is not. */
  appStoreUrl?: string;
  /** The campaign price open on the episode; absent when none is. */
  campaign?: EpisodeCampaign;
  /**
   * What the reader's coins can do here; absent for a guest, and where the
   * episode is not sold for coins on the site.
   */
  coinOffer?: CoinOffer;
  /** The tenant's currency, `null` while the tenant could not be read. */
  currency: string | null;
  episodeId: string;
  episodePublicId: string;
  googlePlayBadge?: TenantImageVariant;
  googlePlayUrl?: string;
  locale: Locale;
  /** Absent when no later episode of the series is free right now. */
  nextFreeEpisode?: EpisodeNeighborItem;
  /**
   * The providers the site's checkout pays through, which a signed-in reader
   * chooses between above the checkouts while there is more than one.
   */
  paymentProviders: readonly PaymentProviderOption[];
  /** Whether the gate is the page after the episode's preview pages. */
  previewEnded?: boolean;
  /** What the permanent copy costs. */
  price: number;
  /**
   * The promotion code the URL carried, quoted for the reader; absent where
   * the gate offers no code field: to a guest, and on a tenant that holds no
   * code a reader could enter.
   */
  promotionCode?: PromotionCodeState<EpisodeSaleKind>;
  purchaseSurface: EpisodePurchaseSurface;
  /** How long a rental lasts; 0, with `rentalPrice`, when it is not rented. */
  rentalPeriodHours: number;
  rentalPrice: number;
  seriesPublicId: string;
  signedIn: boolean;
  /** Whether a plan the site sells right now opens this episode. */
  subscribable: boolean;
  /** Whether the tenant states a tax rate, which every price includes. */
  taxIncluded: boolean;
  tenantId: string;
  /**
   * The tenant's time zone, which a recharging ticket's instant and the end of
   * a campaign are written in.
   */
  timeZone: string;
  /** Absent on a series that does not offer wait-for-free. */
  waitFree?: WaitFreeOffer;
}) => {
  // An episode the site cannot sell goes to the app while the app can sell it,
  // whether the app alone may sell it or the site takes no payments. Where
  // neither can, the gate says what it says for any episode nobody can buy.
  const destination = episodeSaleDestination(
    purchaseSurface,
    toTenantSaleChannels({ acceptsPayments, appPayments })
  );

  const soldInApp = destination === "app";
  const payable = destination === "web";

  const { sellingAppStoreUrl, sellingGooglePlayUrl } = sellingStoreUrls(
    appPayments,
    { appStoreUrl, googlePlayUrl }
  );

  const ticketReady = waitFree?.kind === "ready";
  const shuTaken = ticketReady || coinsCarryShu(coinOffer);

  let accessAction: ReactNode = null;

  if (signedIn && payable) {
    accessAction = (
      <CheckoutActions
        campaign={campaign}
        currency={currency}
        episodeId={episodeId}
        episodePublicId={episodePublicId}
        locale={locale}
        price={price}
        rentalPeriodHours={rentalPeriodHours}
        rentalPrice={rentalPrice}
        seriesPublicId={seriesPublicId}
        shuElsewhere={shuTaken}
        taxIncluded={taxIncluded}
        tenantId={tenantId}
      />
    );
  } else if (!signedIn) {
    accessAction = (
      <LinkButton
        render={
          <LocaleLink
            href={episodeLoginHref(seriesPublicId, episodePublicId)}
          />
        }
        size="lg"
        variant="secondary"
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
          <Message message="storefront.episode.gate.login" />
        </Suspense>
      </LinkButton>
    );
  }

  const gate = (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <p className="font-serif text-xl leading-tight">
          <Suspense fallback={<SkeletonLine className="mx-auto h-5 w-64" />}>
            <GateTitle previewEnded={previewEnded} signedIn={signedIn} />
          </Suspense>
        </p>
        <p className="text-sm text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            <ClosedBecause
              payable={payable || offersCoinPayment(coinOffer)}
              signedIn={signedIn}
              soldInApp={soldInApp}
            />
          </Suspense>
        </p>
      </div>
      <div className="grid justify-items-center gap-6">
        {waitFree ? (
          <WaitFreeSection
            episodeId={episodeId}
            episodePublicId={episodePublicId}
            locale={locale}
            offer={waitFree}
            seriesPublicId={seriesPublicId}
            tenantId={tenantId}
            timeZone={timeZone}
          />
        ) : null}
        {payable && currency && campaign ? (
          <p className="text-sm tabular-nums">
            <CampaignPrice
              campaign={campaign}
              currency={currency}
              locale={locale}
              price={price}
              taxIncluded={taxIncluded}
              timeZone={timeZone}
            />
          </p>
        ) : null}
        <PaymentProviderChoice.Picker />
        <CoinSection
          episodeId={episodeId}
          episodePublicId={episodePublicId}
          locale={locale}
          offer={coinOffer}
          rentalPeriodHours={rentalPeriodHours}
          seriesPublicId={seriesPublicId}
          shuTaken={ticketReady}
          tenantId={tenantId}
        />
        {/* Signed in, the store is the one way into this episode and carries
          the Shu, unless a ready ticket or the reader's coins open it here.
          A guest who bought it in the app still has to sign in, so signing in
          keeps it. */}
        {soldInApp && (sellingAppStoreUrl || sellingGooglePlayUrl) ? (
          <AppStoreLinks
            appStoreBadge={appStoreBadge}
            appStoreUrl={sellingAppStoreUrl}
            googlePlayBadge={googlePlayBadge}
            googlePlayUrl={sellingGooglePlayUrl}
            variant={signedIn && !shuTaken ? "secondary" : "outline"}
          />
        ) : null}
        <div className="flex flex-wrap justify-center gap-3">
          {accessAction}
          {subscribable ? (
            <LinkButton
              render={<LocaleLink href="/plans" />}
              size="lg"
              variant="outline"
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="storefront.episode.gate.subscribe" />
              </Suspense>
            </LinkButton>
          ) : null}
          <LinkButton
            render={<LocaleLink href={`/series/${seriesPublicId}`} />}
            variant="outline"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
              <Message message="storefront.episode.to_series_detail" />
            </Suspense>
          </LinkButton>
        </div>
        <PromotionCode.Field subject="episode">
          <input name="tenantId" type="hidden" value={tenantId} />
          <input name="seriesPublicId" type="hidden" value={seriesPublicId} />
          <input name="episodePublicId" type="hidden" value={episodePublicId} />
          <input name="episodeId" type="hidden" value={episodeId} />
          {episodeSaleKinds({ rentalPeriodHours, rentalPrice }).map((kind) => (
            <input key={kind} name="kinds" type="hidden" value={kind} />
          ))}
        </PromotionCode.Field>
        {nextFreeEpisode ? (
          <LinkButton
            render={
              <LocaleLink
                href={episodePath(seriesPublicId, nextFreeEpisode.publicId)}
              />
            }
            variant="link"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message
                message="storefront.episode.gate.next_free_episode"
                values={{ number: nextFreeEpisode.orderIndex }}
              />
            </Suspense>
          </LinkButton>
        ) : null}
      </div>
    </div>
  );

  return (
    <PaymentProviderChoice.Root
      providers={gatePaymentProviders({
        coinOffer,
        payable,
        paymentProviders,
        signedIn,
      })}
      tenantId={tenantId}
    >
      <PromotionCodeScope
        offer={offeredPromotionCode({
          currency,
          payable,
          promotionCode,
          signedIn,
        })}
      >
        {gate}
      </PromotionCodeScope>
    </PaymentProviderChoice.Root>
  );
};
